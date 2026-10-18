import type { ModelPickerPriceTier } from "./model-picker-data";

export interface PriceDimension { parameter: string; label: string }
export interface PricePivotRow {
  key: string;
  label: string;
  value?: string;
  cells: readonly (ModelPickerPriceTier | undefined)[];
}
export type ModelPriceLayout = { kind: "list"; tiers: readonly ModelPickerPriceTier[] } | {
  kind: "pivot";
  rowDimension: PriceDimension;
  columnDimension?: PriceDimension;
  groupDimension?: PriceDimension;
  columns: readonly { key: string; label: string; value?: string }[];
  groups: readonly { key: string; label?: string; value?: string; rows: readonly PricePivotRow[] }[];
  hasRemainder: boolean;
};

const dimensionOrder = (key: string) => key === "quality" ? 100 : ["tier", "resolution", "size_tier", "image_size"].includes(key) ? 50 : 0;
const numericOrder = new Intl.Collator("zh-CN", { numeric: true });

/** Space only the generated CJK/Latin boundary; keep supplier labels intact. */
function remainderLabel(label: string): string {
  return `其余${/^[A-Za-z0-9_]/u.test(label) ? " " : ""}${label}`;
}

/**
 * Ordered conditions select the first matching branch (media-billing.ts), not
 * the most specific one. A missing suffix dimension therefore covers the
 * remaining partitions only where no earlier branch matched. Evaluate that
 * same first-match rule for every cell, including an explicit complement of
 * the named values. Never rename a missing condition to a supplier default.
 */
export function modelPriceLayout(tiers: readonly ModelPickerPriceTier[]): ModelPriceLayout {
  const list: ModelPriceLayout = { kind: "list", tiers };
  if (tiers.length < 2 || tiers.some(tier => tier.otherwise || !tier.conditions.length ||
    tier.matching === "ordered" && tier.conditionMode !== "all" ||
    tier.conditions.some(condition => condition.operator !== "equals") ||
    new Set(tier.conditions.map(condition => condition.parameter)).size !== tier.conditions.length)) return list;
  const matching = tiers[0]!.matching;
  if (tiers.some(tier => tier.matching !== matching)) return list;
  const dimensions = [...new Map(tiers.flatMap(tier => tier.conditions.map(condition =>
    [condition.parameter, { parameter: condition.parameter, label: condition.label }] as const))).values()]
    .sort((a, b) => dimensionOrder(a.parameter) - dimensionOrder(b.parameter));
  if (!dimensions.length || dimensions.length > 3 || matching === "unique-dimension" && dimensions.length !== 1) return list;
  // Only a shared hierarchy may omit suffix dimensions. Disjoint dimension
  // sets (e.g. quality-only beside resolution-only) retain their literal list.
  if (tiers.some(tier => dimensions.slice(0, tier.conditions.length).some(dimension =>
    !tier.conditions.some(condition => condition.parameter === dimension.parameter)))) return list;
  const values = dimensions.map(dimension => {
    const explicit = [...new Set(tiers.flatMap(tier => tier.conditions.filter(condition => condition.parameter === dimension.parameter).map(condition => condition.value)))];
    const absent = tiers.some(tier => !tier.conditions.some(condition => condition.parameter === dimension.parameter));
    return [...explicit, ...(absent ? [undefined] : [])];
  });
  if (values.reduce((total, items) => total * items.length, 1) > 200) return list;
  const groupIndex = dimensions.length === 3 ? 0 : undefined;
  const rowIndex = dimensions.length === 3 ? 1 : 0;
  const columnIndex = dimensions.length > 1 ? dimensions.length - 1 : undefined;
  const name = (index: number, value: string | undefined) => value === undefined ? remainderLabel(dimensions[index]!.label) : value;
  const key = (value: string | undefined) => value === undefined ? "remainder" : `value:${value}`;
  const columns = columnIndex !== undefined ? values[columnIndex]!.map(value => ({ key: key(value), label: name(columnIndex, value), value })) : [{ key: "price", label: "金额" }];
  const rowValues = [...values[rowIndex]!].sort((a, b) => a === undefined ? 1 : b === undefined ? -1 : numericOrder.compare(a, b));
  const seen = new Set<number>();
  const groups = (groupIndex !== undefined ? values[groupIndex]! : [undefined]).map(group => ({
    key: key(group), value: group, ...(groupIndex !== undefined ? { label: `${dimensions[groupIndex]!.label} ${name(groupIndex, group)}` } : {}),
    rows: rowValues.map(row => ({ key: key(row), label: name(rowIndex, row), value: row,
      cells: (columnIndex !== undefined ? values[columnIndex]! : [undefined]).map(column => {
        const parameters: Record<string, string | undefined> = { [dimensions[rowIndex]!.parameter]: row };
        if (groupIndex !== undefined) parameters[dimensions[groupIndex]!.parameter] = group;
        if (columnIndex !== undefined) parameters[dimensions[columnIndex]!.parameter] = column;
        const matches = tiers.filter(tier => tier.conditions.every(condition => {
          const value = parameters[condition.parameter];
          return value !== undefined && (matching === "unique-dimension" ? value.toLowerCase() === condition.value.toLowerCase() : value === condition.value);
        }));
        const tier = matching === "ordered" ? matches[0] : matches.length === 1 ? matches[0] : undefined;
        if (tier) seen.add(tier.sourceIndex);
        return tier;
      }) })),
  }));
  // Duplicate/shadowed branches remain visible in a list, even when they can
  // never win. A pivot must never discard an original tariff fact.
  if (seen.size !== tiers.length) return list;
  return { kind: "pivot", rowDimension: dimensions[rowIndex]!,
    ...(groupIndex !== undefined ? { groupDimension: dimensions[groupIndex]! } : {}),
    ...(columnIndex !== undefined ? { columnDimension: dimensions[columnIndex]! } : {}), columns, groups,
    hasRemainder: values.some(items => items.includes(undefined)) };
}

/** Locate one partition of a pivot with the exact normalized estimate inputs. */
export function modelPricePivotCellMatches(layout: Extract<ModelPriceLayout, { kind: "pivot" }>, groupIndex: number, rowIndex: number, columnIndex: number,
  parameters: Readonly<Record<string, unknown>>): boolean {
  const group = layout.groups[groupIndex], row = group?.rows[rowIndex], column = layout.columns[columnIndex];
  if (!group || !row || !column) return false;
  const dimensionMatches = (dimension: PriceDimension | undefined, value: string | undefined, named: readonly (string | undefined)[]) => {
    if (!dimension) return true;
    const input = String(parameters[dimension.parameter] ?? "");
    const dimensionTier = row.cells.find(tier => tier?.matching === "unique-dimension");
    const equals = (item: string) => dimensionTier ? item.toLowerCase() === input.toLowerCase() : item === input;
    return value !== undefined ? equals(value) : !named.some(item => item !== undefined && equals(item));
  };
  return dimensionMatches(layout.groupDimension, group.value, layout.groups.map(item => item.value)) &&
    dimensionMatches(layout.rowDimension, row.value, group.rows.map(item => item.value)) &&
    dimensionMatches(layout.columnDimension, column.value, layout.columns.map(item => item.value));
}
