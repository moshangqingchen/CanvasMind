/** Keeps catalog names readable when they already contain their price label. */
export function appendPriceLabelOnce(
  name: string,
  priceLabel: unknown,
): string {
  if (typeof priceLabel !== "string" || !priceLabel.trim()) return name;
  const price = priceLabel.trim();
  return name.includes(price) ? name : `${name}（${price}）`;
}
