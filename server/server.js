/**
 * Servidor de sincronización de Fastrack.
 *
 * Sin dependencias: `node:sqlite` y `node:http` vienen con Node. Menos que
 * instalar, menos que actualizar, y nada que auditar por vulnerabilidades.
 *
 * Deliberadamente tonto. La lógica de fusión vive en src/core/sync.js y es la
 * MISMA que usa el cliente: si el servidor tuviera su propia versión, las dos
 * derivarían y aparecerían diferencias imposibles de depurar.
 *
 * No hay autenticación aquí. Va detrás de Cloudflare Access, que no deja pasar
 * nada sin identificar. Ver DEPLOY.md — arrancarlo expuesto a internet sin ese
 * túnel delante sería abrir tus datos a cualquiera.
 */

import { createServer } from 'node:http';
import { mergeRecords, changedSince, highWaterMark } from '../src/core/sync.js';

// Comprobación antes de importar node:sqlite. Sin esto, una versión antigua de
// Node falla con ERR_UNKNOWN_BUILTIN_MODULE y un volcado de pila que no dice
// qué hacer. `node:sqlite` existe desde la 22.5.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`
Fastrack necesita Node 22.5 o superior. Tienes ${process.versions.node}.

  node:sqlite, que usa el servidor, no existe en tu versión.

  En Ubuntu:
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt install -y nodejs

  O con nvm, sin tocar el Node del sistema:
    nvm install 22 && nvm use 22
`);
  process.exit(1);
}

const { DatabaseSync } = await import('node:sqlite');

const PORT = Number(process.env.PORT ?? 8787);
const DB_PATH = process.env.DB_PATH ?? './fastrack.db';

// Sólo escucha en loopback: el túnel de Cloudflare se conecta desde la misma
// máquina. Así el puerto no queda accesible desde la red local aunque el
// cortafuegos esté mal puesto.
const HOST = process.env.HOST ?? '127.0.0.1';

const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS records (
    user_id   TEXT NOT NULL,
    kind      TEXT NOT NULL,          -- 'event' | 'session' | 'active'
    id        TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    body      TEXT NOT NULL,          -- el registro entero en JSON
    PRIMARY KEY (user_id, kind, id)
  );
  CREATE INDEX IF NOT EXISTS records_cursor
    ON records (user_id, kind, updated_at);
`);

/**
 * Identidad, tomada del JWT que inyecta Cloudflare Access.
 *
 * No se valida la firma aquí: nada llega a este proceso sin haber pasado por
 * Access, que sólo escucha en loopback. Si algún día se expusiera directamente,
 * habría que verificar el JWT contra las claves públicas del equipo.
 *
 * El identificador se guarda desde el principio aunque el usuario sea uno solo:
 * añadirlo después obligaría a migrar cada fila.
 */
function userIdFrom(req) {
  const jwt = req.headers['cf-access-authenticated-user-email'];
  if (typeof jwt === 'string' && jwt) return jwt.toLowerCase();
  return process.env.DEFAULT_USER ?? 'local';
}

function readAll(userId, kind) {
  const rows = db.prepare('SELECT body FROM records WHERE user_id = ? AND kind = ?').all(userId, kind);
  return rows.map((r) => JSON.parse(r.body));
}

function writeAll(userId, kind, records) {
  const stmt = db.prepare(
    'INSERT INTO records (user_id, kind, id, updated_at, body) VALUES (?, ?, ?, ?, ?) ' +
    'ON CONFLICT(user_id, kind, id) DO UPDATE SET updated_at = excluded.updated_at, body = excluded.body'
  );
  // Una transacción: si algo falla a mitad, no queda medio sincronizado.
  db.exec('BEGIN');
  try {
    for (const r of records) {
      stmt.run(userId, kind, r.id, r.updatedAt ?? r.at ?? r.startedAt ?? 0, JSON.stringify(r));
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/**
 * Un ciclo de sincronización.
 *
 * El cliente manda lo que ha cambiado desde su última marca de agua. El
 * servidor fusiona, guarda, y devuelve lo que el cliente aún no ha visto.
 * Simétrico: los dos lados acaban con lo mismo.
 */
function sync(userId, { since = 0, events = [], sessions = [], activeFast = null }) {
  const storedEvents = readAll(userId, 'event');
  const storedSessions = readAll(userId, 'session');

  const mergedEvents = mergeRecords(storedEvents, events);
  const mergedSessions = mergeRecords(storedSessions, sessions);

  writeAll(userId, 'event', mergedEvents);
  writeAll(userId, 'session', mergedSessions);

  // El ayuno en curso es un único registro. Sólo lo escribe el dispositivo
  // principal, así que no hay que fusionar: gana el más reciente.
  const storedActive = readAll(userId, 'active')[0] ?? null;
  let winningActive = storedActive;
  if (activeFast) {
    const a = activeFast.updatedAt ?? 0;
    const b = storedActive?.updatedAt ?? -1;
    if (a >= b) {
      writeAll(userId, 'active', [{ ...activeFast, id: 'current' }]);
      winningActive = activeFast;
    }
  }

  return {
    events: changedSince(mergedEvents, since),
    sessions: changedSince(mergedSessions, since),
    activeFast: winningActive,
    // La marca sale del máximo observado, no del reloj del servidor: usar la
    // hora actual se saltaría cambios escritos mientras viajaba la respuesta.
    cursor: Math.max(
      highWaterMark(mergedEvents, since),
      highWaterMark(mergedSessions, since),
      winningActive?.updatedAt ?? 0
    ),
    serverTime: Date.now(),
  };
}

const server = createServer(async (req, res) => {
  const send = (code, body) => {
    res.writeHead(code, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    });
    res.end(JSON.stringify(body));
  };

  if (req.method === 'GET' && req.url === '/health') {
    return send(200, { ok: true, time: Date.now() });
  }

  if (req.method !== 'POST' || req.url !== '/sync') {
    return send(404, { error: 'not_found' });
  }

  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      // Tope defensivo: un cuerpo enorme no debe poder tumbar el proceso.
      if (size > 8 * 1024 * 1024) return send(413, { error: 'too_large' });
      chunks.push(chunk);
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    const result = sync(userIdFrom(req), payload);
    send(200, result);
  } catch (e) {
    console.error('[sync] error:', e.message);
    send(400, { error: 'bad_request' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Fastrack sync escuchando en http://${HOST}:${PORT}`);
  console.log(`Base de datos: ${DB_PATH}`);
  if (HOST !== '127.0.0.1') {
    console.warn('AVISO: no está en loopback. Asegúrate de tener Access delante.');
  }
});
