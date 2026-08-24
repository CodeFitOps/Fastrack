/**
 * Proceso principal de Electron — build de macOS.
 *
 * Carga el mismo `dist/` que Android. La única diferencia entre plataformas es
 * el shell: la app es idéntica.
 */

const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('node:path');

const isDev = !app.isPackaged;

/**
 * Ancho de teléfono, centrado.
 *
 * Decisión tomada: las tres pantallas están diseñadas para una columna
 * estrecha. Estirar una barra semanal de siete días a 1400px la deja ridícula, y
 * rediseñar History y Stats para escritorio es un trabajo aparte que no bloquea
 * el empaquetado. La ventana es redimensionable pero con un máximo, para que no
 * se pueda llegar a ese estado roto por accidente.
 */
const WINDOW = { width: 460, height: 900, minWidth: 380, maxWidth: 620, minHeight: 600 };

function createWindow() {
  const win = new BrowserWindow({
    width: WINDOW.width,
    height: WINDOW.height,
    minWidth: WINDOW.minWidth,
    maxWidth: WINDOW.maxWidth,
    minHeight: WINDOW.minHeight,
    // La barra de título integrada deja que la cabecera de la app llegue arriba
    // del todo, como en el diseño.
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#F3F2F2',
    show: false,
    webPreferences: {
      // La app no necesita Node en el renderer: es una SPA que sólo usa
      // localStorage. Mantener el aislamiento activado y Node desactivado es el
      // ajuste seguro por defecto, y aquí no cuesta nada.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Evita el parpadeo blanco del arranque.
  win.once('ready-to-show', () => win.show());

  if (isDev) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Cualquier enlace externo va al navegador, nunca dentro de la ventana de la
  // app — si no, un enlace convertiría la app en un navegador sin barra de
  // direcciones ni forma de volver.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

app.whenReady().then(() => {
  createWindow();
  buildMenu();

  // En macOS, pulsar el icono del Dock con la app abierta y sin ventanas debe
  // abrir una.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// En macOS lo habitual es que la app siga viva sin ventanas; en el resto, no.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/**
 * Menú mínimo. Sin esto Electron pone uno por defecto lleno de entradas de
 * ejemplo ("Learn More", "Toggle Developer Tools") que no pintan nada en una app
 * distribuida.
 */
function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edición',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Ventana',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
