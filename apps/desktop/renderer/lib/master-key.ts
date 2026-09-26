/** The Electron host supplies the DPAPI-protected key in memory. */
export function serverMasterKey(): string | undefined {
  if (process.env.MASTER_KEY) return process.env.MASTER_KEY;
  if (process.env.NODE_ENV === "test") return "local-development-master-key";
  return undefined;
}
export function requireServerMasterKey(): string {
  const masterKey = serverMasterKey();
  if (!masterKey) throw new Error("MASTER_KEY is required to protect provider credentials");
  return masterKey;
}
