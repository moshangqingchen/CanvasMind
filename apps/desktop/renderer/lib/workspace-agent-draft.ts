const prefix = "supercanvas.agent-draft.";
/** Session-scoped transport. This never submits a turn or changes a canvas. */
export function saveWorkspaceAgentDraft(
  id: string,
  value: string,
  storage: Pick<Storage, "setItem">,
) {
  if (value.trim()) storage.setItem(`${prefix}${id}`, value);
}
export function takeWorkspaceAgentDraft(
  id: string,
  storage: Pick<Storage, "getItem" | "removeItem">,
) {
  const value = storage.getItem(`${prefix}${id}`);
  if (value !== null) storage.removeItem(`${prefix}${id}`);
  return value ?? "";
}
