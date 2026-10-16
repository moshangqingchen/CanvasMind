/** CSS is the color source of truth, including the procedural scene. */
export const NEURAL_MODULES = ["canvases", "suppliers", "accounts", "starts"] as const;
export type NeuralModule = typeof NEURAL_MODULES[number];
export type NeuralTheme = "dark" | "light";
export type NeuralRgb = readonly [number, number, number];

export const neuralColorVariables = {
  background: "--neural-bg", center: "--neural-bg-center", silver: "--neural-silver",
  ember: "--neural-ember", emberLight: "--neural-ember-light", gold: "--neural-gold",
  shell: "--neural-core-shell", shellLine: "--neural-core-line",
  canvases: "--neural-canvases", suppliers: "--neural-suppliers",
  accounts: "--neural-accounts", starts: "--neural-starts",
} as const;

export type NeuralPalette = Record<keyof typeof neuralColorVariables, NeuralRgb>;

export function parseNeuralColor(value: string): NeuralRgb {
  const hex = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return [0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255) as unknown as NeuralRgb;
  }
  const numbers = value.match(/[\d.]+/g);
  if (numbers && numbers.length >= 3) return [Number(numbers[0]) / 255, Number(numbers[1]) / 255, Number(numbers[2]) / 255];
  throw new Error(`Missing neural scene color token: ${value}`);
}

export function readNeuralPalette(element: Element): NeuralPalette {
  const styles = getComputedStyle(element);
  return Object.fromEntries(Object.entries(neuralColorVariables).map(([key, variable]) => [key, parseNeuralColor(styles.getPropertyValue(variable))])) as NeuralPalette;
}

export function neuralCssColor(module: NeuralModule): string {
  return `var(${neuralColorVariables[module]})`;
}
