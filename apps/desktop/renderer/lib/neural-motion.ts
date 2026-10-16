import { NEURAL_MODULES, type NeuralModule } from "./neural-tokens";

export interface NeuralPoint { x: number; y: number }
export interface NeuralSpring { value: number; velocity: number }
export interface NeuralLayout {
  core: NeuralPoint & { radius: number };
  modules: Record<NeuralModule, NeuralPoint & { radius: number }>;
}

/** Exact critically damped solution; stable at any refresh rate, with no overshoot. */
export function stepNeuralSpring(spring: NeuralSpring, target: number, seconds: number, stiffness = 150): NeuralSpring {
  if (seconds <= 0) return spring;
  const omega = Math.sqrt(Math.max(.01, stiffness));
  const delta = spring.value - target;
  const coefficient = spring.velocity + omega * delta;
  const decay = Math.exp(-omega * seconds);
  const value = target + (delta + coefficient * seconds) * decay;
  const velocity = (spring.velocity - omega * coefficient * seconds) * decay;
  if (Math.abs(value - target) < .002 && Math.abs(velocity) < .002) return { value: target, velocity: 0 };
  return { value, velocity };
}

/** Every position is in CSS pixels, shared by the canvas and accessible DOM hit areas. */
export function neuralLayout(width: number, height: number, selected: NeuralModule | null): NeuralLayout {
  const w = Math.max(1, width), h = Math.max(1, height);
  const short = Math.min(w, h);
  const hub: Record<NeuralModule, [number, number]> = {
    canvases: [.28, .29], suppliers: [.71, .27], accounts: [.77, .56], starts: [.24, .57],
  };
  const others = NEURAL_MODULES.filter(module => module !== selected);
  return {
    core: { x: w * (selected ? .085 : .5), y: h * (selected ? .5 : .48), radius: short * (selected ? .06 : .22) },
    modules: Object.fromEntries(NEURAL_MODULES.map(module => {
      const index = others.indexOf(module);
      const y = module === selected ? .5 : [.23, .72, .86][index];
      return [module, {
        x: w * (selected ? .23 : hub[module][0]),
        y: h * (selected ? y : hub[module][1]),
        radius: short * (selected ? (module === selected ? .0864 : .0544) : .0832),
      }];
    })) as NeuralLayout["modules"],
  };
}

export function neuralFrameInterval(motion: boolean, dimmed: boolean, focused: boolean): number {
  if (!motion) return Number.POSITIVE_INFINITY;
  return 1000 / (dimmed ? 20 : focused ? 60 : 30);
}

export interface NeuralQualityState { level: 0 | 1 | 2; slowSeconds: number }
/** A lower particle budget must retain every module's point cloud. */
export function neuralParticleDrawRanges(total: number, groups: number, fraction: number) {
  const count = Math.max(0, Math.floor(total));
  const groupCount = Math.max(1, Math.floor(groups));
  const keep = Math.max(0, Math.min(1, fraction));
  return Array.from({ length: groupCount }, (_, index) => {
    const first = Math.floor(count * index / groupCount);
    const end = Math.floor(count * (index + 1) / groupCount);
    return { first, count: Math.floor((end - first) * keep) };
  });
}
/** Only sustained slow frames reduce quality; focused/inactive throttling is excluded by the caller. */
export function stepNeuralQuality(state: NeuralQualityState, frameMilliseconds: number, seconds: number): NeuralQualityState {
  if (state.level === 2) return state;
  const slowSeconds = frameMilliseconds > 20 ? state.slowSeconds + Math.max(0, seconds) : Math.max(0, state.slowSeconds - seconds * 2);
  return slowSeconds >= 2 ? { level: (state.level + 1) as 1 | 2, slowSeconds: 0 } : { level: state.level, slowSeconds };
}

export function neuralEntityOffset(id: string, index: number): NeuralPoint {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  const seed = (hash >>> 0) / 4294967295;
  const angle = seed * Math.PI * 2 + index * 2.3999632297;
  const radius = 50 + Math.sqrt(index + 1) * 14 + seed * 68;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * .65 };
}
