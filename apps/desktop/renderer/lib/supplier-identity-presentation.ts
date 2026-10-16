const IDENTITY_PALETTES = [
  { from: "var(--cover-1-from)", to: "var(--cover-1-to)", ink: "var(--cover-1-ink)" },
  { from: "var(--cover-2-from)", to: "var(--cover-2-to)", ink: "var(--cover-2-ink)" },
  { from: "var(--cover-3-from)", to: "var(--cover-3-to)", ink: "var(--cover-3-ink)" },
  { from: "var(--cover-4-from)", to: "var(--cover-4-to)", ink: "var(--cover-4-ink)" },
  { from: "var(--cover-5-from)", to: "var(--cover-5-to)", ink: "var(--cover-5-ink)" },
  { from: "var(--cover-6-from)", to: "var(--cover-6-to)", ink: "var(--cover-6-ink)" },
] as const;

/** Text initials and decorative colors only; no vendor logos or catalog state. */
export function supplierIdentityPresentation(name: string) {
  const label = name.trim();
  let hash = 2166136261;
  for (let index = 0; index < label.length; index += 1) {
    hash = Math.imul(hash ^ label.charCodeAt(index), 16777619) >>> 0;
  }
  return { initial: Array.from(label)[0] ?? "供", ...IDENTITY_PALETTES[hash % IDENTITY_PALETTES.length]! };
}
