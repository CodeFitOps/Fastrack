import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, defaultRole, canControlFast, canEditFast, canLogEvents, blockedReason } from './roles.js';

test('sin sincronización, cualquier dispositivo lo puede todo', () => {
  // Es el único dispositivo que hay: bloquearlo dejaría la app inservible.
  // Éste es el estado actual de la app y no debe cambiar al añadir papeles.
  for (const role of [ROLES.primary, ROLES.secondary, undefined]) {
    assert.equal(canControlFast({ role, syncEnabled: false }), true);
    assert.equal(blockedReason({ role, syncEnabled: false }), null);
  }
});

test('con sincronización, sólo el principal empieza y termina ayunos', () => {
  assert.equal(canControlFast({ role: ROLES.primary, syncEnabled: true }), true);
  assert.equal(canControlFast({ role: ROLES.secondary, syncEnabled: true }), false);
});

test('el secundario recibe un motivo, no un botón muerto', () => {
  assert.equal(
    blockedReason({ role: ROLES.secondary, syncEnabled: true }),
    'role.onlyPrimaryControls'
  );
});

test('el secundario no toca el ayuno en absoluto, ni para corregir la hora', () => {
  // Regla explicable en una frase: los ayunos se llevan desde el móvil.
  assert.equal(canEditFast({ role: ROLES.secondary, syncEnabled: true }), false);
  assert.equal(canEditFast({ role: ROLES.primary, syncEnabled: true }), true);
});

test('registrar eventos está permitido desde cualquier dispositivo', () => {
  // Es justo lo que se quiere del portátil: notas cómodas con teclado.
  assert.equal(canLogEvents(), true);
});

test('una app nativa se asume principal; un navegador, secundario', () => {
  assert.equal(defaultRole('capacitor'), ROLES.primary);
  assert.equal(defaultRole('tauri'), ROLES.primary);
  assert.equal(defaultRole('web'), ROLES.secondary);
  assert.equal(defaultRole('memory'), ROLES.secondary);
});

test('un papel desconocido no otorga control por accidente', () => {
  assert.equal(canControlFast({ role: 'loquesea', syncEnabled: true }), false);
  assert.equal(canControlFast({ syncEnabled: true }), false);
});
