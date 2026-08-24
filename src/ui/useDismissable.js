import { useEffect } from 'react';
import { pushLayer } from './layerStack.js';

/**
 * Registra una capa abierta para que el botón atrás de Android y la tecla
 * Escape la cierren. No hace nada mientras `open` sea false.
 */
export function useDismissable(open, onClose) {
  useEffect(() => {
    if (!open) return undefined;

    const unregister = pushLayer(onClose);

    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    return () => {
      unregister();
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
}
