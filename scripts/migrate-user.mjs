#!/usr/bin/env node
/**
 * Mueve los registros de un usuario a otro.
 *
 * Hace falta al activar Cloudflare Access: hasta entonces todo se guarda bajo
 * `local`, porque no llega ninguna cabecera de identidad. En cuanto Access
 * empieza a inyectar tu email, el servidor te busca bajo ese email y la app
 * aparece vacía — los datos siguen ahí, en otro cajón.
 *
 *   node scripts/migrate-user.mjs local tu@correo.com
 *   node scripts/migrate-user.mjs local tu@correo.com --apply
 *
 * Sin `--apply` sólo enseña lo que haría. Es la opción por defecto a propósito:
 * mover datos de salud al cajón equivocado y no darse cuenta es peor que un
 * paso de más.
 */

import { DatabaseSync } from 'node:sqlite';

const [, , from, to, ...flags] = process.argv;
const apply = flags.includes('--apply');
const dbPath = process.env.DB_PATH ?? `${process.env.HOME}/fastrack.db`;

if (!from || !to) {
  console.error(`
Uso: node scripts/migrate-user.mjs <origen> <destino> [--apply]

  node scripts/migrate-user.mjs local tu@correo.com
  node scripts/migrate-user.mjs local tu@correo.com --apply

Base de datos: ${dbPath}  (cámbiala con DB_PATH)
`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);

const usuarios = db.prepare(
  'SELECT user_id, COUNT(*) AS n FROM records GROUP BY user_id ORDER BY n DESC'
).all();

console.log('\nUsuarios en la base:');
for (const u of usuarios) console.log(`  ${u.user_id.padEnd(32)} ${u.n} registros`);

const origen = usuarios.find((u) => u.user_id === from);
if (!origen) {
  console.error(`\nNo hay nada bajo "${from}". Nada que mover.`);
  process.exit(1);
}

const destino = usuarios.find((u) => u.user_id === to);
const detalle = db.prepare(
  'SELECT kind, COUNT(*) AS n FROM records WHERE user_id = ? GROUP BY kind'
).all(from);

console.log(`\nSe moverían ${origen.n} registros de "${from}" a "${to}":`);
for (const d of detalle) console.log(`  ${d.kind.padEnd(10)} ${d.n}`);

if (destino) {
  // Colisión de ids: la clave primaria es (user_id, kind, id), así que un
  // UPDATE directo fallaría. Se avisa en vez de sobrescribir a ciegas.
  const choque = db.prepare(
    'SELECT COUNT(*) AS n FROM records a WHERE a.user_id = ? ' +
    'AND EXISTS (SELECT 1 FROM records b WHERE b.user_id = ? AND b.kind = a.kind AND b.id = a.id)'
  ).get(from, to).n;

  console.log(`\n"${to}" ya tiene ${destino.n} registros.`);
  if (choque > 0) {
    console.log(`  ${choque} coinciden en identificador y se conservarán los del destino.`);
  }
}

if (!apply) {
  console.log('\nEsto es sólo una vista previa. Añade --apply para hacerlo de verdad.');
  console.log(`Antes conviene una copia:  cp ${dbPath} ${dbPath}.bak\n`);
  process.exit(0);
}

db.exec('BEGIN');
try {
  // Primero los que no chocan; los que chocan se quedan donde están.
  const movidos = db.prepare(
    'UPDATE records SET user_id = ? WHERE user_id = ? ' +
    'AND NOT EXISTS (SELECT 1 FROM records b WHERE b.user_id = ? AND b.kind = records.kind AND b.id = records.id)'
  ).run(to, from, to);
  db.exec('COMMIT');
  console.log(`\nMovidos ${movidos.changes} registros a "${to}".`);

  const resto = db.prepare('SELECT COUNT(*) AS n FROM records WHERE user_id = ?').get(from).n;
  if (resto > 0) {
    console.log(`Quedan ${resto} en "${from}" por coincidir en identificador con los del destino.`);
  }
} catch (e) {
  db.exec('ROLLBACK');
  console.error('\nFalló, no se ha cambiado nada:', e.message);
  process.exit(1);
}
console.log('Reinicia el servicio:  sudo systemctl restart fastrack\n');
