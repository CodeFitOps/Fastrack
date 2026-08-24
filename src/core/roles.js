/**
 * Papel del dispositivo.
 *
 * Nace de una decisión de producto: sólo el móvil empieza y termina ayunos. Eso
 * elimina el conflicto feo de la sincronización —dos dispositivos creando
 * ayunos distintos, o uno cerrando mientras el otro abre— sin tener que
 * resolverlo, que siempre es mejor que resolverlo bien.
 *
 * ── La distinción que importa ─────────────────────────────────────────
 *
 * No es «quién puede escribir» sino «qué pasa si escriben los dos».
 *
 *   CICLO DE VIDA (empezar, terminar): dos escrituras simultáneas producen
 *   estados incompatibles. Se restringe a un solo dispositivo.
 *
 *   CAMPOS de un ayuno que ya existe (corregir la hora de inicio, una nota):
 *   dos escrituras producen dos versiones del mismo registro, y quedarse con la
 *   más reciente es una respuesta correcta. No hace falta restringirlo.
 *
 *   EVENTOS: cada uno lleva id propio y se añaden más que se editan. Se fusionan
 *   sin problema.
 *
 * Por eso el portátil no puede empezar un ayuno pero sí corregirle la hora de
 * inicio, que es exactamente el tipo de tarea fina para la que un teclado va
 * mejor que un móvil.
 *
 * ── Sin sincronización, no hay papeles ────────────────────────────────
 *
 * Un dispositivo que no sincroniza es el único que hay: puede hacerlo todo.
 * Los papeles sólo entran en juego cuando hay un servidor de por medio.
 */

export const ROLES = {
  /** Lleva el ayuno. Normalmente el móvil, que es el que está siempre encima. */
  primary: 'primary',
  /** Consulta, registra eventos y edita. No empieza ni termina ayunos. */
  secondary: 'secondary',
};

/**
 * Papel por defecto de este dispositivo.
 *
 * Una app nativa se lleva encima; un navegador suele ser el portátil. Es una
 * suposición razonable de partida, y se puede cambiar a mano.
 */
export function defaultRole(platform) {
  return platform === 'capacitor' || platform === 'tauri' ? ROLES.primary : ROLES.secondary;
}

/**
 * ¿Puede este dispositivo empezar o terminar un ayuno?
 *
 * Sin sincronización activa siempre sí: es el único dispositivo que hay, y
 * bloquearlo dejaría la app inservible.
 */
export function canControlFast({ role, syncEnabled }) {
  if (!syncEnabled) return true;
  return role === ROLES.primary;
}

/**
 * ¿Puede tocar el ayuno de alguna forma? Empezarlo, terminarlo o corregirle la
 * hora de inicio.
 *
 * Decisión endurecida a propósito: el secundario no toca el ayuno en absoluto.
 * Permitir sólo la corrección de la hora habría sido defendible, pero la regla
 * «los ayunos se llevan desde el móvil, y punto» es la que se puede explicar en
 * una frase y no deja al usuario adivinando qué edición sí y cuál no.
 */
export function canEditFast({ role, syncEnabled }) {
  return canControlFast({ role, syncEnabled });
}

/**
 * Registrar eventos —comidas, cetonas, entrenos, notas— está siempre permitido
 * desde cualquier dispositivo. Es justo lo que se quiere del portátil.
 */
export function canLogEvents() {
  return true;
}

/**
 * Motivo por el que no se puede controlar el ayuno, como clave de traducción,
 * o null si sí se puede. La interfaz debe explicarlo, no limitarse a
 * deshabilitar un botón sin decir por qué.
 */
export function blockedReason({ role, syncEnabled }) {
  return canControlFast({ role, syncEnabled }) ? null : 'role.onlyPrimaryControls';
}
