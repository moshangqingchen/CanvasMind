import { supplierKeyForConnection } from "./supplier-identity";
export const SUPPLIER_TEMPLATE_API_URLS: Record<string, string> = {
  cangyuan: "https://ai.cangyuansuanli.cn",
  cyberafei: "https://api.3365api.cn",
  frimodel: "https://api.frimodel.com/v1",
  chentu: "https://tu.988236.xyz/v1",
  miaowu: "https://api.miaowuai.store",
  mikoto: "https://api.mikoto.vip",
  weai: "https://asian-acc.we-token.cc/v1",
  openai: "https://api.openai.com/v1",
};
export function matchesSupplierTemplate(connection: {
  provider: string;
  config: Readonly<Record<string, unknown>>;
}): boolean {
  const key = supplierKeyForConnection(connection);
  const official = SUPPLIER_TEMPLATE_API_URLS[key];
  if (!official) return false;
  const normalize = (value: string) =>
    new URL(value)
      .toString()
      .replace(/\/+$/u, "")
      .replace(/\/v1(?:beta)?$/iu, "");
  try {
    return (
      normalize(String(connection.config.baseUrl || official)) ===
      normalize(official)
    );
  } catch {
    return false;
  }
}
