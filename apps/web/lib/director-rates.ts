import type { ExchangeRateTable } from "@super-canvas/director";

const ECB_URL =
  "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const CACHE_MS = 12 * 60 * 60 * 1_000;
const VALID_MS = 72 * 60 * 60 * 1_000;

interface RateCache {
  value?: ExchangeRateTable;
  expiresAt: number;
  pending?: Promise<ExchangeRateTable | undefined>;
}

const cacheKey = "__superCanvasDirectorRates";

function cache(): RateCache {
  const scope = globalThis as typeof globalThis & { [cacheKey]?: RateCache };
  return (scope[cacheKey] ??= { expiresAt: 0 });
}

function parseEcbRates(xml: string, checkedAt: string): ExchangeRateTable | undefined {
  const entries = [...xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/gu)];
  const perEuro = Object.fromEntries(
    entries.flatMap((match) => {
      const rate = Number(match[2]);
      return match[1] && Number.isFinite(rate) && rate > 0 ? [[match[1], rate]] : [];
    }),
  );
  const cny = perEuro.CNY;
  if (!cny) return undefined;
  const rates = Object.fromEntries(
    Object.entries(perEuro).map(([currency, rate]) => [currency, cny / rate]),
  );
  rates.CNY = 1;
  return {
    base: "CNY",
    checkedAt,
    validUntil: new Date(Date.parse(checkedAt) + VALID_MS).toISOString(),
    rates,
  };
}

export function manualExchangeRates(
  value: unknown,
  now = new Date(),
): ExchangeRateTable | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const rates = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([currency, rate]) =>
      typeof rate === "number" && Number.isFinite(rate) && rate > 0
        ? [[currency.toUpperCase(), rate]]
        : [],
    ),
  );
  if (Object.keys(rates).length === 0) return undefined;
  rates.CNY = 1;
  return {
    base: "CNY",
    checkedAt: now.toISOString(),
    validUntil: new Date(now.getTime() + VALID_MS).toISOString(),
    rates,
  };
}

export async function loadExchangeRates(
  manual?: unknown,
): Promise<ExchangeRateTable | undefined> {
  const override = manualExchangeRates(manual);
  if (override) return override;
  const state = cache();
  if (state.value && state.expiresAt > Date.now()) return state.value;
  if (state.pending) return state.pending;
  state.pending = (async () => {
    try {
      const response = await fetch(ECB_URL, {
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return state.value;
      const checkedAt = new Date().toISOString();
      const parsed = parseEcbRates(await response.text(), checkedAt);
      if (parsed) {
        state.value = parsed;
        state.expiresAt = Date.now() + CACHE_MS;
      }
      return parsed ?? state.value;
    } catch {
      return state.value;
    } finally {
      state.pending = undefined;
    }
  })();
  return state.pending;
}

export { parseEcbRates };
