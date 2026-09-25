import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * Radix only returns focus to a Dialog.Trigger on close. Details and player open without a trigger
 * (via tile or URL), so we remember the focused element ourselves. Pass the result to
 * onCloseAutoFocus of Dialog.Content.
 */
export function useReturnFocus(open: boolean) {
  const target = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    // Runs before mounting into the portal, so focus is still on the opener.
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
