/** Decoration owns a frame only while it has something left to paint. */
export function createCanvasEffectScheduler(
  paint: (time: number) => boolean,
  request: (callback: (time: number) => void) => number,
  cancel: (handle: number) => void,
) {
  let frame: number | null = null;
  let disposed = false;
  const tick = (time: number) => {
    frame = null;
    if (!disposed && paint(time)) frame = request(tick);
  };
  return {
    wake() { if (!disposed && frame === null) frame = request(tick); },
    stop() { if (frame !== null) cancel(frame); frame = null; },
    dispose() { disposed = true; if (frame !== null) cancel(frame); frame = null; },
    get active() { return frame !== null; },
  };
}

export function canvasAmbientDetail(enabled: boolean, zoom: number, visibleNodes: number) {
  return enabled && zoom >= .55 && visibleNodes <= 150 ? "full" : "off";
}

/** Gestures suspend both decoration paints and graph/viewport projection. The
 * quiet interval also covers the final wheel transform after the last event. */
export function createCanvasEffectGestureGate(
  pause: () => void,
  reconcile: () => void,
  schedule: (callback: () => void, delay: number) => number,
  cancel: (handle: number) => void,
  wheelQuietMs = 180,
) {
  let pointerDown = false, wheelActive = false, disposed = false;
  let timer: number | null = null, generation = 0;
  const paused = () => pointerDown || wheelActive;
  const cancelTimer = () => { generation++; if (timer !== null) cancel(timer); timer = null; };
  return {
    beginPointer() {
      if (disposed) return;
      const wasPaused = paused(); pointerDown = true;
      if (!wasPaused) pause();
    },
    endPointer() {
      if (disposed || !pointerDown) return;
      pointerDown = false;
      if (!paused()) reconcile();
    },
    wheel() {
      if (disposed) return;
      const wasPaused = paused(); wheelActive = true;
      if (!wasPaused) pause();
      cancelTimer(); const epoch = generation;
      timer = schedule(() => {
        if (disposed || epoch !== generation) return;
        timer = null; wheelActive = false;
        if (!paused()) reconcile();
      }, wheelQuietMs);
    },
    reset() { cancelTimer(); pointerDown = false; wheelActive = false; },
    dispose() { disposed = true; cancelTimer(); pointerDown = false; wheelActive = false; },
    get paused() { return paused(); },
  };
}
