"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Brush, Check, CircleAlert, Eraser, Hand, LoaderCircle, Maximize2, Redo2, RotateCcw, Undo2, X, ZoomIn, ZoomOut } from "lucide-react";
import { registerDesktopSave } from "../lib/desktop-client";
import { IMAGE_MASK_COLOR, imageMaskFileName, imageMaskFitScale, imageMaskPointFromClient, maskPixelsToSelection, selectionPixelsHaveEdits, selectionPixelsToMask, validateImageMaskSize } from "../lib/image-mask";
import type { ImageMaskPoint, ImageMaskSize } from "../lib/image-mask";
import { useDialogFocus } from "./use-dialog-focus";
import styles from "./image-mask-editor.module.css";

export interface ImageMaskEditorProps {
  imageSrc: string;
  imageName: string;
  initialMaskSrc?: string;
  onSave: (file: File, size: ImageMaskSize) => Promise<void>;
  onClose: () => void;
  saveLabel?: string;
}

type Tool = "brush" | "eraser" | "hand";
type Stroke = { kind: "stroke"; tool: "brush" | "eraser"; width: number; points: ImageMaskPoint[] };
type Command = Stroke | { kind: "clear" };
type Gesture = { pointerId: number; stroke: Stroke } | { pointerId: number; origin: ImageMaskPoint; scroll: ImageMaskPoint };
const MAX_HISTORY_POINTS = 100_000;
const MAX_HISTORY_COMMANDS = 1000;
const STRIP_ROWS = 128;

function contextFor(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前环境无法创建绘图画布，请关闭窗口后重试。");
  return context;
}

function loadImage(src: string, signal: AbortSignal, label: string, readPixels = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (readPixels) image.crossOrigin = "anonymous";
    const finish = (error?: Error) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      image.onload = image.onerror = null;
      if (error) { image.src = ""; reject(error); } else resolve(image);
    };
    const abort = () => finish(new Error("图片加载已取消。"));
    const timer = setTimeout(() => finish(new Error(`${label}加载超时，请检查图片地址后重试。`)), 30_000);
    image.onload = () => finish();
    image.onerror = () => finish(new Error(`${label}加载失败，请检查图片是否仍可访问。`));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort(); else image.src = src;
  });
}

function paintSegment(context: CanvasRenderingContext2D, stroke: Stroke, from: ImageMaskPoint, to = from) {
  context.save();
  context.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  context.strokeStyle = context.fillStyle = `rgb(${IMAGE_MASK_COLOR.join(",")})`;
  context.lineWidth = stroke.width;
  context.lineCap = context.lineJoin = "round";
  context.beginPath();
  if (from.x === to.x && from.y === to.y) {
    context.arc(to.x, to.y, stroke.width / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }
  context.restore();
}

function hasSelection(canvas: HTMLCanvasElement): boolean {
  const context = contextFor(canvas);
  for (let y = 0; y < canvas.height; y += STRIP_ROWS) {
    if (selectionPixelsHaveEdits(context.getImageData(0, y, canvas.width, Math.min(STRIP_ROWS, canvas.height - y)).data)) return true;
  }
  return false;
}

async function exportMask(canvas: HTMLCanvasElement): Promise<Blob> {
  const output = document.createElement("canvas");
  output.width = canvas.width;
  output.height = canvas.height;
  try {
    const source = contextFor(canvas);
    const destination = contextFor(output);
    let selected = false;
    for (let y = 0; y < canvas.height; y += STRIP_ROWS) {
      const pixels = source.getImageData(0, y, canvas.width, Math.min(STRIP_ROWS, canvas.height - y));
      selected = selectionPixelsToMask(pixels.data) || selected;
      destination.putImageData(pixels, 0, y);
    }
    if (!selected) throw new Error("请先涂抹需要修改的区域。");
    return await new Promise<Blob>((resolve, reject) => output.toBlob(blob => blob ? resolve(blob) : reject(new Error("蒙版导出失败，请关闭其他大图后重试。")), "image/png"));
  } finally {
    output.width = output.height = 1;
  }
}

export function ImageMaskEditor({ imageSrc, imageName, initialMaskSrc, onSave, onClose, saveLabel = "保存重绘区域" }: ImageMaskEditorProps) {
  const titleId = useId();
  const descriptionId = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const initialRef = useRef<HTMLCanvasElement | null>(null);
  const historyRef = useRef<Command[]>([]);
  const cursorRef = useRef(0);
  const gestureRef = useRef<Gesture | null>(null);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const savePromiseRef = useRef<Promise<void> | null>(null);
  const epochRef = useRef(0);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const [size, setSize] = useState<ImageMaskSize | null>(null);
  const [viewport, setViewport] = useState<ImageMaskSize>({ width: 800, height: 500 });
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [tool, setTool] = useState<Tool>("brush");
  const [brushSize, setBrushSize] = useState(48);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [history, setHistory] = useState({ cursor: 0, length: 0 });
  const [selected, setSelected] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [pointer, setPointer] = useState<ImageMaskPoint | null>(null);

  function requestClose() {
    if (savingRef.current) return;
    if (dirtyRef.current) setConfirmClose(true); else onClose();
  }
  const dialogRef = useDialogFocus(true, requestClose);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const epoch = ++epochRef.current;
    const canvas = canvasRef.current;
    historyRef.current = [];
    cursorRef.current = 0;
    gestureRef.current = null;
    dirtyRef.current = false;
    void (async () => {
      // Let Strict Mode dispose its probe before loading/allocating image data.
      await Promise.resolve();
      if (!canvas || controller.signal.aborted) return;
      setReady(false);
      setLoadError("");
      setError("");
      setSize(null);
      setSelected(false);
      setConfirmClose(false);
      setDrawing(false);
      setPointer(null);
      setZoom("fit");
      setHistory({ cursor: 0, length: 0 });
      const image = await loadImage(imageSrc, controller.signal, "原图");
      if (controller.signal.aborted) return;
      const dimensions = { width: image.naturalWidth, height: image.naturalHeight };
      validateImageMaskSize(dimensions);
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      contextFor(canvas).clearRect(0, 0, canvas.width, canvas.height);
      if (initialMaskSrc) {
        const mask = await loadImage(initialMaskSrc, controller.signal, "已保存的蒙版", true);
        if (controller.signal.aborted) return;
        if (mask.naturalWidth !== dimensions.width || mask.naturalHeight !== dimensions.height) throw new Error("已保存蒙版与原图尺寸不同，请重新选择对应原图。");
        const baseline = document.createElement("canvas");
        baseline.width = dimensions.width;
        baseline.height = dimensions.height;
        initialRef.current = baseline;
        const context = contextFor(baseline);
        context.drawImage(mask, 0, 0);
        try {
          for (let y = 0; y < baseline.height; y += STRIP_ROWS) {
            const pixels = context.getImageData(0, y, baseline.width, Math.min(STRIP_ROWS, baseline.height - y));
            maskPixelsToSelection(pixels.data);
            context.putImageData(pixels, 0, y);
          }
        } catch {
          throw new Error("无法读取已保存的蒙版，请使用本地素材或允许跨域访问的 PNG 图片。");
        }
        contextFor(canvas).drawImage(baseline, 0, 0);
      }
      if (controller.signal.aborted) return;
      setSize(dimensions);
      setBrushSize(Math.min(Math.max(dimensions.width, dimensions.height), 384, Math.max(12, Math.round(Math.max(dimensions.width, dimensions.height) / 30))));
      setSelected(hasSelection(canvas));
      setReady(true);
    })().catch(reason => {
      if (!controller.signal.aborted && epochRef.current === epoch) {
        if (canvas) canvas.width = canvas.height = 1;
        if (initialRef.current) initialRef.current.width = initialRef.current.height = 1;
        initialRef.current = null;
        setLoadError(reason instanceof Error ? reason.message : "图片加载失败，请重试。");
      }
    });
    return () => {
      controller.abort();
      epochRef.current = epoch + 1;
      gestureRef.current = null;
      if (canvas) canvas.width = canvas.height = 1;
      if (initialRef.current) initialRef.current.width = initialRef.current.height = 1;
      initialRef.current = null;
    };
  }, [imageSrc, initialMaskSrc, retry]);

  useEffect(() => {
    if (confirmClose) confirmButtonRef.current?.focus();
  }, [confirmClose]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current && !savingRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    const unregister = registerDesktopSave(async () => {
      if (savePromiseRef.current) await savePromiseRef.current;
      if (dirtyRef.current) throw new Error("局部重绘区域尚未保存，请先保存或放弃涂抹修改，再退出。");
    });
    return () => { window.removeEventListener("beforeunload", beforeUnload); unregister(); };
  }, []);

  const scale = size ? zoom === "fit" ? imageMaskFitScale(size, viewport) : zoom : 1;
  const displayWidth = size ? size.width * scale : 0;
  const displayHeight = size ? size.height * scale : 0;
  const disabled = !ready || saving || drawing || confirmClose;

  function updateHistory() {
    dirtyRef.current = cursorRef.current > 0;
    setHistory({ cursor: cursorRef.current, length: historyRef.current.length });
    if (canvasRef.current) setSelected(hasSelection(canvasRef.current));
  }

  function replay(nextCursor: number) {
    if (disabled || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const context = contextFor(canvas);
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (initialRef.current) context.drawImage(initialRef.current, 0, 0);
    for (const command of historyRef.current.slice(0, nextCursor)) {
      if (command.kind === "clear") context.clearRect(0, 0, canvas.width, canvas.height);
      else command.points.forEach((point, index) => paintSegment(context, command, command.points[Math.max(0, index - 1)]!, point));
    }
    cursorRef.current = nextCursor;
    updateHistory();
  }

  function clearSelection() {
    if (disabled || !selected || !canvasRef.current) return;
    historyRef.current = [...historyRef.current.slice(0, cursorRef.current), { kind: "clear" }];
    cursorRef.current = historyRef.current.length;
    contextFor(canvasRef.current).clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setError("");
    updateHistory();
  }

  function position(event: { clientX: number; clientY: number }): ImageMaskPoint | null {
    const canvas = canvasRef.current;
    return canvas && size ? imageMaskPointFromClient({ x: event.clientX, y: event.clientY }, canvas.getBoundingClientRect(), size) : null;
  }

  function startGesture(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (disabled || gestureRef.current || event.button !== 0 || !canvasRef.current) return;
    const point = position(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "hand") {
      const viewport = viewportRef.current;
      if (!viewport) return;
      gestureRef.current = { pointerId: event.pointerId, origin: { x: event.clientX, y: event.clientY }, scroll: { x: viewport.scrollLeft, y: viewport.scrollTop } };
    } else {
      const history = historyRef.current.slice(0, cursorRef.current);
      const points = history.reduce((sum, command) => sum + (command.kind === "stroke" ? command.points.length : 0), 0);
      if (points >= MAX_HISTORY_POINTS || history.length >= MAX_HISTORY_COMMANDS) {
        setError("涂抹记录较多，请先保存区域，再重新打开继续编辑。");
        event.currentTarget.releasePointerCapture(event.pointerId);
        return;
      }
      const stroke: Stroke = { kind: "stroke", tool, width: brushSize, points: [point] };
      historyRef.current = [...history, stroke];
      cursorRef.current = historyRef.current.length;
      gestureRef.current = { pointerId: event.pointerId, stroke };
      dirtyRef.current = true;
      paintSegment(contextFor(canvasRef.current), stroke, point);
      setError("");
    }
    setDrawing(true);
  }

  function moveGesture(event: ReactPointerEvent<HTMLCanvasElement>) {
    const point = position(event);
    if (point && size && point.x >= 0 && point.y >= 0 && point.x <= size.width && point.y <= size.height) setPointer(point); else setPointer(null);
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || !canvasRef.current) return;
    event.preventDefault();
    if (!("stroke" in gesture)) {
      viewportRef.current?.scrollTo(gesture.scroll.x + gesture.origin.x - event.clientX, gesture.scroll.y + gesture.origin.y - event.clientY);
      return;
    }
    const native = event.nativeEvent;
    const samples = native.getCoalescedEvents?.() ?? [];
    for (const sample of [...samples, native]) {
      const next = position(sample);
      const previous = gesture.stroke.points.at(-1)!;
      if (!next || (next.x === previous.x && next.y === previous.y)) continue;
      if (gesture.stroke.points.length >= MAX_HISTORY_POINTS) { setError("本次连续涂抹较长，请松开画笔后保存区域。"); break; }
      gesture.stroke.points.push(next);
      paintSegment(contextFor(canvasRef.current), gesture.stroke, previous, next);
    }
  }

  function finishGesture(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (gestureRef.current?.pointerId !== event.pointerId) return;
    if (event.type === "pointerup") moveGesture(event);
    gestureRef.current = null;
    setDrawing(false);
    updateHistory();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function changeZoom(next: number | "fit") {
    if (disabled) return;
    setZoom(next === "fit" ? next : Math.max(0.025, Math.min(4, next)));
    setPointer(null);
  }

  function save() {
    const canvas = canvasRef.current;
    if (!canvas || !size || !ready || !selected || savingRef.current || gestureRef.current) return;
    const epoch = epochRef.current;
    savingRef.current = true;
    setSaving(true);
    setError("");
    const pending = (async () => {
      try {
        const blob = await exportMask(canvas);
        if (epoch !== epochRef.current) return;
        await onSave(new File([blob], imageMaskFileName(imageName), { type: "image/png" }), size);
        if (epoch !== epochRef.current) return;
        dirtyRef.current = false;
        onClose();
      } catch (reason) {
        if (epoch === epochRef.current) setError(reason instanceof Error ? reason.message : "保存失败，请重试。涂抹内容仍保留在这里。");
      } finally {
        savingRef.current = false;
        savePromiseRef.current = null;
        if (epoch === epochRef.current) setSaving(false);
      }
    })();
    savePromiseRef.current = pending;
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={styles.backdrop} onPointerDown={event => event.stopPropagation()}>
      <section ref={dialogRef} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}
        onKeyDown={event => {
          event.stopPropagation();
          if (disabled || !(event.ctrlKey || event.metaKey) || (event.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(event.target.tagName))) return;
          const key = event.key.toLowerCase();
          if (key === "z" || key === "y") {
            event.preventDefault();
            const next = key === "y" || event.shiftKey ? cursorRef.current + 1 : cursorRef.current - 1;
            if (next >= 0 && next <= historyRef.current.length) replay(next);
          }
        }}>
        <header className={styles.header}>
          <div className={styles.heading}><span className={styles.icon}><Brush size={22} /></span><div><p className={styles.eyebrow}>局部编辑</p><h2 id={titleId}>涂抹重绘区域</h2><p className={styles.fileName} title={imageName}>{imageName}</p></div></div>
          <button type="button" className={styles.iconButton} onClick={requestClose} disabled={saving} aria-label="关闭蒙版编辑器"><X size={20} /></button>
        </header>
        <p className={styles.description} id={descriptionId}>涂上紫色，告诉 AI 需要修改哪里。其余区域会尽量保留，生成后请检查边界与细节。</p>
        <div className={styles.toolbar}>
          <div className={styles.tools} role="group" aria-label="涂抹工具">
            <button type="button" onClick={() => setTool("brush")} aria-pressed={tool === "brush"} disabled={disabled}><Brush size={16} />画笔</button>
            <button type="button" onClick={() => setTool("eraser")} aria-pressed={tool === "eraser"} disabled={disabled}><Eraser size={16} />橡皮</button>
            <button type="button" onClick={() => setTool("hand")} aria-pressed={tool === "hand"} disabled={disabled}><Hand size={16} />拖动画面</button>
          </div>
          <label className={styles.brushControl}>画笔大小<input type="range" min={1} max={size ? Math.min(2048, Math.max(size.width, size.height)) : 512} step={1} value={brushSize} disabled={disabled || tool === "hand"} onChange={event => setBrushSize(Number(event.target.value))} aria-label="画笔大小" /><output>{brushSize} px</output></label>
          <div className={styles.historyTools}>
            <button type="button" className={styles.iconButton} onClick={() => replay(cursorRef.current - 1)} disabled={disabled || history.cursor === 0} title="撤销（Ctrl/⌘ Z）" aria-label="撤销涂抹"><Undo2 size={17} /></button>
            <button type="button" className={styles.iconButton} onClick={() => replay(cursorRef.current + 1)} disabled={disabled || history.cursor === history.length} title="重做（Ctrl/⌘ Shift Z）" aria-label="重做涂抹"><Redo2 size={17} /></button>
            <button type="button" className={styles.clearButton} onClick={clearSelection} disabled={disabled || !selected}><RotateCcw size={15} />清空</button>
          </div>
        </div>
        <div className={styles.viewport} ref={viewportRef} onScroll={() => setPointer(null)}>
          <div className={styles.world} style={{ width: Math.max(viewport.width, displayWidth + 48), height: Math.max(viewport.height, displayHeight + 48) }}>
            <div className={styles.sheet} style={{ width: displayWidth || 1, height: displayHeight || 1, visibility: ready ? "visible" : "hidden" }}>
              {/* The source is only displayed; it is never painted into either mask canvas. */}
              {size && <img src={imageSrc} alt="局部重绘原图" draggable={false} className={styles.source} />}
              <canvas ref={canvasRef} className={styles.selection} data-tool={tool} aria-label="在原图上涂抹需要重绘的区域" tabIndex={ready ? 0 : -1}
                onPointerDown={startGesture} onPointerMove={moveGesture} onPointerUp={finishGesture} onPointerCancel={finishGesture} onLostPointerCapture={finishGesture} onPointerLeave={() => setPointer(null)} />
              {pointer && tool !== "hand" && ready && <span className={styles.cursor} data-eraser={tool === "eraser"} style={{ left: pointer.x * scale, top: pointer.y * scale, width: Math.max(1, brushSize * scale), height: Math.max(1, brushSize * scale) }} />}
            </div>
          </div>
          {!ready && <div className={styles.loadState}>{loadError ? <><CircleAlert size={30} /><strong>暂时无法编辑这张图片</strong><p role="alert">{loadError}</p><button type="button" className={styles.secondary} onClick={() => setRetry(value => value + 1)}>重新加载</button></> : <><LoaderCircle size={28} className={styles.spinning} /><p role="status">正在准备原图与蒙版…</p></>}</div>}
        </div>
        <div className={styles.viewBar}>
          <span className={styles.legend}><i />紫色为重绘区域<span className={styles.dimensions}>{size ? `${size.width} × ${size.height}` : "原图尺寸"}</span></span>
          <div className={styles.zoomTools}>
            <button type="button" className={styles.iconButton} disabled={disabled || scale <= 0.025} onClick={() => changeZoom(scale / 1.5)} aria-label="缩小预览"><ZoomOut size={16} /></button>
            <output aria-label="预览缩放比例">{Math.round(scale * 100)}%</output>
            <button type="button" className={styles.iconButton} disabled={disabled || scale >= 4} onClick={() => changeZoom(scale * 1.5)} aria-label="放大预览"><ZoomIn size={16} /></button>
            <button type="button" className={styles.fitButton} disabled={disabled} onClick={() => changeZoom("fit")}><Maximize2 size={15} />适应画面</button>
          </div>
        </div>
        {error && <div className={styles.error} role="alert"><CircleAlert size={16} /><span>{error}</span></div>}
        {confirmClose && <div className={styles.confirm} role="alert"><div><strong>还没有保存涂抹区域</strong><p>关闭后，本次修改将丢失。</p></div><button ref={confirmButtonRef} type="button" className={styles.secondary} onClick={() => setConfirmClose(false)}>继续编辑</button><button type="button" className={styles.discard} onClick={onClose}>放弃修改</button></div>}
        <footer className={styles.footer}>
          <span aria-live="polite">{saving ? "正在保存蒙版…" : selected ? "区域已标记，保存后继续填写修改要求。" : "先用画笔标记一块需要修改的区域。"}</span>
          <div><button type="button" className={styles.secondary} onClick={requestClose} disabled={saving}>取消</button><button type="button" className={styles.primary} onClick={save} disabled={disabled || !selected}>{saving ? <LoaderCircle size={17} className={styles.spinning} /> : <Check size={17} />}{saving ? "保存中…" : saveLabel}</button></div>
        </footer>
      </section>
    </div>, document.body,
  );
}
