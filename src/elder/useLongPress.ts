import { useRef } from "react";

/**
 * Press-and-hold. Used where an accidental tap would be costly (Help) or
 * where the elder shouldn't wander in by mistake (settings).
 */
export function useLongPress(onDone: () => void, ms: number, onChange?: (holding: boolean) => void) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cancel = () => {
    clearTimeout(timer.current);
    onChange?.(false);
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      onChange?.(true);
      timer.current = setTimeout(() => {
        onChange?.(false);
        onDone();
      }, ms);
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
}
