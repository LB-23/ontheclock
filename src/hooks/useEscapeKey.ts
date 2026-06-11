import { useEffect } from 'react'

/** Dismiss-on-Escape behaviour for modals, sheets, and other temporary
 *  surfaces. Pass the close callback and a boolean indicating whether
 *  the surface is currently visible — the listener auto-detaches when
 *  the surface closes so we don't accumulate handlers.
 *
 *  Per Apple HIG + Material Design, Esc is the canonical keyboard
 *  gesture for "dismiss the topmost transient surface". Without this
 *  hook, keyboard-only users have no escape route from the app's
 *  modals — backdrop-click works but isn't reachable by Tab. */
export function useEscapeKey(isOpen: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose])
}
