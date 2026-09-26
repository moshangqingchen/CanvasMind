const pendingEditors = new Set<{ flush: () => void }>();

/** Register an editor whose buffered changes must reach the canvas before save or exit. */
export function registerPendingEditorEdit(flush: () => void): () => void {
  const entry = { flush };
  pendingEditors.add(entry);
  return () => { pendingEditors.delete(entry); };
}

export function flushPendingEditorEdits(): void {
  for (const entry of [...pendingEditors]) {
    if (pendingEditors.has(entry)) entry.flush();
  }
}
