/** Visual wrapping boundaries only; joining the parts reproduces the quote verbatim. */
export function compactPriceParts(label: string): readonly string[] {
  const clauses: string[] = [];
  let start = 0, depth = 0;
  for (let index = 0; index < label.length; index++) {
    const character = label[index];
    if (character === "（" || character === "(") depth++;
    else if (character === "）" || character === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && label.startsWith(" · ", index)) {
      clauses.push(label.slice(start, index)); start = index; index += 2;
    }
  }
  clauses.push(label.slice(start));
  return clauses.flatMap(clause => {
    const parts: string[] = [];
    let cursor = 0, open = -1, nesting = 0;
    for (let index = 0; index < clause.length; index++) {
      const character = clause[index];
      if (character === "（" || character === "(") {
        if (nesting++ === 0) open = index;
      } else if ((character === "）" || character === ")") && nesting > 0 && --nesting === 0) {
        const before = clause.slice(cursor, open);
        // A separator belongs to the fact that follows it, never a line alone.
        if (before && !/^\s*·?\s*$/u.test(before)) {
          parts.push(before); parts.push(clause.slice(open, index + 1));
        } else parts.push(clause.slice(cursor, index + 1));
        cursor = index + 1;
      }
    }
    if (cursor < clause.length) parts.push(clause.slice(cursor));
    return parts.filter(Boolean);
  });
}
