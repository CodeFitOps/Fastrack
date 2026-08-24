/**
 * Nombres de los paquetes nativos, y el cargador que los importa.
 *
 * Por qué existe este fichero en vez de escribir el `import()` en su sitio:
 * Vite analiza estáticamente cualquier `import()` cuyo especificador sea un
 * literal, y falla si el paquete no está instalado — aunque la línea nunca
 * llegue a ejecutarse. `@vite-ignore` no lo evita con un literal.
 *
 * Guardando el nombre en una variable, el análisis estático no puede
 * resolverlo y lo deja pasar al runtime. Y en runtime sólo se ejecuta si la
 * plataforma detectada es esa, así que en web y en dev nunca se toca.
 *
 * El resultado práctico: `npm run dev` arranca sin instalar nada de Tauri ni
 * de Capacitor, y cada shell instala sólo sus propios paquetes.
 */

const PKG = {
  tauriStore: '@tauri-apps/plugin-store',
  tauriNotification: '@tauri-apps/plugin-notification',
  capacitorPreferences: '@capacitor/preferences',
  capacitorNotifications: '@capacitor/local-notifications',
  capacitorApp: '@capacitor/app',
  capacitorStatusBar: '@capacitor/status-bar',
};

/**
 * Importa un paquete nativo por clave. Devuelve null si no está instalado, en
 * vez de propagar el error: que falte el plugin de notificaciones no debe
 * tumbar la app, sólo dejarla sin notificaciones.
 *
 * @param {keyof typeof PKG} key
 */
export async function loadNative(key) {
  const name = PKG[key];
  if (!name) return null;
  try {
    return await import(/* @vite-ignore */ name);
  } catch {
    return null;
  }
}
