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
