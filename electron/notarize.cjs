/**
 * Notarización para macOS.
 *
 * Sin esto, Gatekeeper bloquea la app en cualquier Mac que no sea el tuyo con
 * un "no se puede abrir porque Apple no puede comprobar si contiene software
 * malicioso" — y no hay forma obvia de saltárselo para un usuario normal.
 *
 * Necesita tres variables de entorno. Si falta alguna, se salta la notarización
 * con un aviso en vez de romper el build: así se pueden hacer builds locales
 * para probar sin credenciales de Apple.
 *
 *   APPLE_ID              tu Apple ID
 *   APPLE_APP_PASSWORD    contraseña específica de app (NO la del Apple ID)
 *   APPLE_TEAM_ID         el Team ID de tu cuenta de desarrollador
 *
 * Genera la contraseña específica en https://appleid.apple.com → Seguridad.
 * Nunca la metas en el repositorio.
 */

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  const { APPLE_ID, APPLE_APP_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_PASSWORD || !APPLE_TEAM_ID) {
    console.warn('[notarize] Faltan credenciales de Apple — se omite la notarización.');
    console.warn('[notarize] El .dmg sólo abrirá en este Mac.');
    return;
  }

  const { notarize } = require('@electron/notarize');
  const appName = context.packager.appInfo.productFilename;

  console.log('[notarize] Enviando a Apple. Suele tardar entre 5 y 15 minutos.');
  await notarize({
    appPath: `${appOutDir}/${appName}.app`,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });
  console.log('[notarize] Listo.');
};
