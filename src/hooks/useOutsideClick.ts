import { useEffect } from 'react';
import type { RefObject } from 'react';

/**
 * Close a popover when the user clicks anywhere outside of it.
 * Only listens while `active` is true, so idle dropdowns cost nothing.
 */
export function useOutsideClick<T extends HTMLElement>(
  ref: RefObject<T | null>,
  active: boolean,
  onOutside: () => void,
) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ref, active, onOutside]);
}
