/**
 * Pila de capas descartables.
 *
 * Las hojas (protocolo, registro) guardan su estado en la pantalla que las abre.
 * El botón atrás de Android vive en App. Sin un punto común habría que bajar
 * callbacks por props hasta cada hoja, y cada hoja nueva volvería a romperlo.
 *
 * En vez de eso, cada capa abierta registra aquí su función de cierre. El botón
 * atrás —y la tecla Escape— cierran siempre la de más arriba. Añadir una hoja
 * nueva no requiere tocar App.
 *
 * Es estado de módulo a propósito: sólo hay una pila de capas visible, igual que
 * sólo hay una pantalla. Un contexto de React daría lo mismo con más ceremonia.
 */

const stack = [];

/** Registra una capa abierta. Devuelve la función para darla de baja. */
export function pushLayer(close) {
  const entry = { close };
  stack.push(entry);
  return () => {
    const i = stack.indexOf(entry);
    if (i !== -1) stack.splice(i, 1);
  };
}

/** Cierra la capa superior. `true` si había alguna. */
export function popLayer() {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.close();
  // No se saca de la pila aquí: al cerrarse, el efecto de la capa llama a su
  // propia baja. Sacarla ahora dejaría la pila descuadrada si el cierre falla.
  return true;
}

export function hasLayers() {
  return stack.length > 0;
}

/** Sólo para tests. */
export function resetLayers() {
  stack.length = 0;
}
