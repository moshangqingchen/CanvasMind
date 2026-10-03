"use client";
import { useEffect, useRef } from "react";
interface DialogFocusEntry {
  previousFocus: HTMLElement | null;
  returnFocus: () => HTMLElement | null | undefined;
  parent: DialogFocusEntry | undefined;
}
const openDialogs: DialogFocusEntry[] = [];
const focusableSelector =
  'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, audio[controls], video[controls], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(focusableSelector),
  ).filter(
    (element) =>
      !element.hidden &&
      (!element.hasAttribute("tabindex") || element.tabIndex >= 0) &&
      !element.matches(":disabled") &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.getClientRects().length > 0,
  );
}

function getReturnFocus(entry: DialogFocusEntry): HTMLElement | null {
  // Parent and child can close in the same commit. Keep each opening's parent
  // record so the child can recover the outside trigger after its parent DOM
  // and its own inside trigger have both been removed.
  for (let current: DialogFocusEntry | undefined = entry; current; current = current.parent) {
    const requested = current.returnFocus();
    if (requested?.isConnected) return requested;
    if (current.previousFocus?.isConnected) return current.previousFocus;
  }
  return null;
}

export function useDialogFocus(
  open: boolean,
  onClose: () => void,
  returnFocus?: HTMLElement | null,
) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const returnFocusRef = useRef(returnFocus);

  useEffect(() => {
    onCloseRef.current = onClose;
    returnFocusRef.current = returnFocus;
  }, [onClose, returnFocus]);

  useEffect(() => {
    if (!open) return;

    const entry: DialogFocusEntry = {
      previousFocus: document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null,
      returnFocus: () => returnFocusRef.current,
      parent: openDialogs.at(-1),
    };
    openDialogs.push(entry);

    const focusDialog = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog || openDialogs.at(-1) !== entry) return;
      (getFocusableElements(dialog)[0] ?? dialog).focus({
        preventScroll: true,
      });
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog || openDialogs.at(-1) !== entry) return;

      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = getFocusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;

      if (
        event.shiftKey &&
        (active === first || active === dialog || !dialog.contains(active))
      ) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (
        !event.shiftKey &&
        (active === last || !dialog.contains(active))
      ) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusDialog);
      document.removeEventListener("keydown", handleKeyDown, true);
      const wasTopDialog = openDialogs.at(-1) === entry;
      const index = openDialogs.indexOf(entry);
      if (index >= 0) openDialogs.splice(index, 1);
      const previousFocus = wasTopDialog ? getReturnFocus(entry) : null;
      if (previousFocus) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [open]);

  return dialogRef;
}
