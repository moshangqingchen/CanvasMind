export interface PortLabelRect { left: number; top: number; right: number; bottom: number }

/** Labels yield to card content when the user has placed cards close together. */
export function portLabelObscuresCard(label: PortLabelRect, cards: readonly PortLabelRect[], clearance = 2) {
  return cards.some(card => label.left < card.right + clearance && label.right > card.left - clearance &&
    label.top < card.bottom + clearance && label.bottom > card.top - clearance);
}
