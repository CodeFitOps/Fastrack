#!/usr/bin/env node
/**
 * Borra los datos del servidor. Para modo de pruebas.
 *
 *   node scripts/reset-server.mjs                    # lista lo que hay
 *   node scripts/reset-server.mjs --user tu@correo   # borra ese usuario
 *   node scripts/reset-server.mjs --all              # borra todo
 *
 * Sin `--yes` sólo enseña lo que haría. Borrar datos de salud sin querer no
 * tiene vuelta atrás, así que el paso de más está puesto a propósito.
 *
 * OJO CON EL ORDEN: vaciar sólo el servidor no basta. Los dispositivos siguen
 * teniendo sus copias, y como el borrado no deja lápidas, cada uno volverá a
 * subir lo suyo en el siguiente ciclo y la base se repuebla sola. Hay que
 * borrar también en cada dispositivo — con el botón de la app o desde la
 * consola del navegador. Este script lo recuerda al terminar.
 */

import { DatabaseSync } from 'node:sqlite';

const args = process.argv.slice(2);
const dbPath = process.env.DB_PATH ?? `${process.env.HOME}/fastrack.db`;
const yes = args.includes('--yes');
const all = args.includes('--all');
const userIdx = args.indexOf('--user');
const user = userIdx !== -1 ? args[userIdx + 1] : null;

const db = new DatabaseSync(dbPath);

const usuarios = db.prepare(
  'SELECT user_id, COUNT(*) AS n FROM records GROUP BY user_id ORDER BY n DESC'
).all();

console.log(`\nBase de datos: ${dbPath}`);

if (usuarios.length === 0) {
  console.log('Está vacía. Nada que borrar.\n');
  process.exit(0);
}

console.log('\nContenido actual:');
for (const u of usuarios) {
  const detalle = db.prepare(
    'SELECT kind, COUNT(*) AS n FROM records WHERE user_id = ? GROUP BY kind'
  ).all(u.user_id);
  const resumen = detalle.map((d) => `${d.n} ${d.kind}`).join(', ');
  console.log(`  ${u.user_id.padEnd(32)} ${resumen}`);
}

if (!all && !user) {
  console.log(`
Elige qué borrar:

  node scripts/reset-server.mjs --user ${usuarios[0].user_id} --yes
  node scripts/reset-server.mjs --all --yes
`);
  process.exit(0);
}

const objetivo = all ? 'TODOS los usuarios' : `"${user}"`;

if (!all && !usuarios.some((u) => u.user_id === user)) {
  console.error(`\nNo hay ningún usuario "${user}". Revisa la lista de arriba.\n`);
  process.exit(1);
}

if (!yes) {
  console.log(`\nSe borraría ${objetivo}, incluido el ayuno en curso.`);
  console.log('Añade --yes para hacerlo de verdad.');
  console.log(`Copia antes:  cp ${dbPath} ${dbPath}.bak\n`);
  process.exit(0);
}

db.exec('BEGIN');
try {
  if (all) {
    db.exec('DELETE FROM records');
    db.exec('DELETE FROM seq_counter');
    db.exec('DELETE FROM primary_device');
  } else {
    db.prepare('DELETE FROM records WHERE user_id = ?').run(user);
    db.prepare('DELETE FROM seq_counter WHERE user_id = ?').run(user);
    // Se libera el papel de principal: el próximo dispositivo que sincronice
    // lo tomará, como en una instalación nueva.
    db.prepare('DELETE FROM primary_device WHERE user_id = ?').run(user);
  }
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  console.error('\nFalló, no se ha borrado nada:', e.message, '\n');
  process.exit(1);
}

console.log(`\nBorrado ${objetivo}.`);
console.log(`
FALTA UN PASO. Los dispositivos conservan su copia y volverán a subirla en
cuanto sincronicen. Borra también en cada uno:

  · en la app: botón de copia de seguridad → BORRAR ESTE DISPOSITIVO
  · o en la consola del navegador:
      Object.keys(localStorage).filter(k=>k.startsWith('fastrack.'))
        .forEach(k=>localStorage.removeItem(k)); location.reload()

Hazlo en TODOS antes de volver a sincronizar, o uno repoblará el resto.
`);
