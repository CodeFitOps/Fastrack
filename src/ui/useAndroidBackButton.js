import { useEffect } from 'react';
import { loadNative } from '../platform/native.js';

/**
 * Botón atrás físico de Android.
 *
 * Sin esto, el botón atrás cierra la app desde cualquier pantalla — incluso con
 * una hoja abierta. En Android es la queja número uno de las apps hechas con
 * WebView, porque rompe el gesto más usado del sistema.
 *
 * El orden es: si hay una hoja abierta, ciérrala. Si no estás en la pestaña
 * principal, vuelve a ella. Sólo si ya estás en la principal y sin nada abierto,
 * deja que la app se cierre.
 *
 * No hace nada fuera de Android; en macOS y web el hook es inerte.
 */
export function useAndroidBackButton({ onBack }) {
  useEffect(() => {
    let listener = null;
    let cancelled = false;

    (async () => {
      const mod = await loadNative('capacitorApp');
      if (!mod || cancelled) return;

      listener = await mod.App.addListener('backButton', ({ canGoBack }) => {
        // `onBack` devuelve true si ha consumido el gesto.
        const handled = onBack();
        if (!handled) {
          // minimizeApp() en vez de exitApp(): salir del todo mata el proceso y
          // la próxima apertura es un arranque en frío. Minimizar es además lo
          // que hace cualquier app nativa desde su pantalla principal.
          mod.App.minimizeApp?.() ?? mod.App.exitApp();
        }
        void canGoBack;
      });
    })();

    return () => {
      cancelled = true;
      listener?.remove?.();
    };
  }, [onBack]);
}
