import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * Radix gibt den Fokus beim Schließen nur an einen Dialog.Trigger zurück. Details und Player öffnen
 * ohne Trigger (per Kachel oder URL), also merken wir uns das fokussierte Element selbst.
 * Rückgabe gehört an onCloseAutoFocus von Dialog.Content.
 */
export function useReturnFocus(open: boolean) {
  const target = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    // Läuft vor dem Einhängen ins Portal, der Fokus liegt also noch auf dem Auslöser.
    if (open && document.activeElement instanceof HTMLElement)
      target.current = document.activeElement;
  }, [open]);
  return useCallback((event: Event) => {
    const element = target.current;
    target.current = null;
    if (!element?.isConnected) return;
    event.preventDefault();
    element.focus({ preventScroll: true });
  }, []);
}
