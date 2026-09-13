/** Keeps catalog names readable when they already contain their price label. */
export function appendPriceLabelOnce(
  name: string,
  priceLabel: unknown,
): string {
  if (typeof priceLabel !== "string" || !priceLabel.trim()) return name;
  const price = priceLabel.trim();
  const cleanName = name.replace(/[（(]价格以(?:平台|模型广场)为准(?:·快照)?[）)]/gu, "");
  return cleanName.includes(price) ? cleanName : `${cleanName}（${price}）`;
}
