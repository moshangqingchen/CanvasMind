export interface LayoutAnimation { finish: () => void; cancel: () => void }

/** One scheduler owns both graph geometry and viewport; no per-node timers. */
export function animateLayout({ duration, frame, complete, request = requestAnimationFrame, cancel = cancelAnimationFrame, now = performance.now() }: {
  duration: number; frame: (progress: number) => void; complete: () => void;
  request?: (callback: FrameRequestCallback) => number; cancel?: (id: number) => void; now?: number;
}): LayoutAnimation {
  let active = true, handle = 0;
  const finish = () => {
    if (!active) return;
    active = false;
    cancel(handle);
    frame(1);
    complete();
  };
  const tick = (time: number) => {
    if (!active) return;
    const t = Math.max(0, Math.min(1, (time - now) / duration));
    if (t === 1) { finish(); return; }
    // Invert x for cubic-bezier(.2,.8,.2,1), once per batch, not per node.
    let u = t;
    for (let i = 0; i < 5; i++) {
      const x = .6 * u - .6 * u * u + u * u * u;
      const derivative = .6 - 1.2 * u + 3 * u * u;
      u = Math.max(0, Math.min(1, u - (x - t) / derivative));
    }
    frame(2.4 * u - 1.8 * u * u + .4 * u * u * u);
    handle = request(tick);
  };
  if (duration <= 0) finish();
  else handle = request(tick);
  return { finish, cancel: () => { active = false; cancel(handle); } };
}
