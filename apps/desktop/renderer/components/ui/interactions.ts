export interface NavigableOption {
  label?: string;
  disabled?: boolean;
}

/** Roving selection skips disabled entries while retaining every rendered row. */
export function nextEnabledIndex(options: readonly Pick<NavigableOption, "disabled">[], current: number, key: string): number {
  const available = options.flatMap((option, index) => option.disabled ? [] : [index]);
  if (!available.length) return -1;
  if (key === "Home") return available[0]!;
  if (key === "End") return available[available.length - 1]!;
  const direction = key === "ArrowUp" || key === "ArrowLeft" ? -1 : 1;
  const position = available.indexOf(current);
  return available[position < 0 ? direction > 0 ? 0 : available.length - 1
    : (position + direction + available.length) % available.length]!;
}

export interface TypeaheadState { text: string; at: number }

export function appendTypeahead(previous: TypeaheadState, key: string, now: number): TypeaheadState {
  return { text: now - previous.at < 700 ? previous.text + key : key, at: now };
}

export function typeaheadIndex(options: readonly NavigableOption[], current: number, input: string): number {
  const normalized = input.toLocaleLowerCase();
  const repeated = normalized.length > 1 && [...normalized].every(letter => letter === normalized[0]);
  const query = repeated ? normalized[0]! : normalized;
  if (!query) return current;
  const start = query.length === 1 ? current + 1 : Math.max(0, current);
  for (let offset = 0; offset < options.length; offset++) {
    const index = (start + offset + options.length) % options.length;
    const option = options[index];
    if (!option?.disabled && option?.label?.toLocaleLowerCase().startsWith(query)) return index;
  }
  return current;
}

export interface SurfaceRect { left: number; right: number; top: number; bottom: number; width: number }

export function anchoredSurfacePlacement({ anchor, bounds, naturalHeight, minWidth, maxWidth, owner, preferSidePlacement = false }: {
  anchor: SurfaceRect;
  bounds: SurfaceRect;
  naturalHeight: number;
  minWidth: number;
  maxWidth: number;
  owner?: SurfaceRect;
  preferSidePlacement?: boolean;
}) {
  const gap = 6;
  let width = Math.max(0, Math.min(Math.max(minWidth, anchor.width), maxWidth, bounds.width));
  const viewportHeight = Math.max(0, bounds.bottom - bounds.top);
  const desiredHeight = Math.min(Math.max(0, naturalHeight), viewportHeight);
  const below = Math.max(0, bounds.bottom - Math.max(bounds.top, anchor.bottom + gap));
  const above = Math.max(0, Math.min(bounds.bottom, anchor.top - gap) - bounds.top);
  const leftSpace = owner ? owner.left - bounds.left - gap : 0;
  const rightSpace = owner ? bounds.right - owner.right - gap : 0;
  if (owner && preferSidePlacement && Math.max(leftSpace, rightSpace) >= minWidth) {
    width = Math.min(width, Math.max(leftSpace, rightSpace));
    return { width, maxHeight: viewportHeight,
      left: rightSpace >= leftSpace ? owner.right + gap : owner.left - gap - width,
      top: Math.max(bounds.top, Math.min(anchor.top, bounds.bottom - desiredHeight)) };
  }
  const placeBelow = below >= desiredHeight || below >= above;
  const maxHeight = Math.min(viewportHeight, placeBelow ? below : above);
  const height = Math.min(desiredHeight, maxHeight);
  return { width, maxHeight,
    left: Math.max(bounds.left, Math.min(anchor.left, bounds.right - width)),
    top: placeBelow ? Math.max(bounds.top, Math.min(anchor.bottom + gap, bounds.bottom - height))
      : Math.max(bounds.top, Math.min(anchor.top - gap - height, bounds.bottom - height)) };
}
