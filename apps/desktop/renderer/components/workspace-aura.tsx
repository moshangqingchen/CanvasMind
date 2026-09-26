"use client";

import { ImageIcon, Sparkles, Type, Video } from "lucide-react";
import { memo, useEffect, useRef } from "react";
import styles from "./workspace-aura.module.css";

const TAU = Math.PI * 2;
const FILAMENTS = 48;
const STEPS = 144;
const FRAME_INTERVAL = 1000 / 30;

const ringSamples = Array.from({ length: STEPS + 1 }, (_, step) => {
  const angle = (step / STEPS) * TAU;
  return { angle, cos: Math.cos(angle), sin: Math.sin(angle) };
});
const filamentSamples = Array.from({ length: FILAMENTS }, (_, filament) => {
  const phase = (filament / FILAMENTS) * TAU;
  return {
    cos: Math.cos(phase),
    sin: Math.sin(phase),
    highlight: filament % 12 === 0,
  };
});

// A deterministic field keeps the decorative composition stable on every visit.
const dust = Array.from({ length: 72 }, (_, index) => {
  const sample = (seed: number) => {
    const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return value - Math.floor(value);
  };
  return {
    x: sample(index + 1),
    y: sample(index + 109),
    radius: 0.45 + sample(index + 221) * 1.05,
    phase: sample(index + 317) * TAU,
  };
});

/** Decorative only: the canvas never updates React state or intercepts input. */
export const WorkspaceAura = memo(function WorkspaceAura({
  paused,
}: {
  paused: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pauseRef = useRef(paused);
  const refreshRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    pauseRef.current = paused;
    refreshRef.current?.();
  }, [paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    let frame = 0;
    let lastFrame = 0;
    let elapsed = 2.4;
    let width = 0;
    let height = 0;
    let ratio = 1;

    // Reused buffers avoid allocating thousands of small objects each frame.
    const points = new Float32Array((STEPS + 1) * 2);
    const tubes = new Float32Array(STEPS + 1);
    const twistCosines = new Float32Array(STEPS + 1);
    const twistSines = new Float32Array(STEPS + 1);
    const draw = () => {
      if (!width || !height) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const scale = Math.min(width / 580, height / 350);
      context.translate(width / 2, height / 2);
      context.scale(scale, scale);

      const time = elapsed;
      const tilt = -0.34 + Math.sin(time * 0.17) * 0.065;
      const cosTilt = Math.cos(tilt);
      const sinTilt = Math.sin(tilt);
      const incline = 0.91 + Math.sin(time * 0.12) * 0.08;
      const cosIncline = Math.cos(incline);
      const sinIncline = Math.sin(incline);

      context.globalCompositeOperation = "lighter";
      for (const particle of dust) {
        const x = (particle.x - 0.5) * 566;
        const y =
          (particle.y - 0.5) * 310 + Math.sin(time * 0.24 + particle.phase) * 8;
        const alpha = 0.14 + (Math.sin(time * 0.7 + particle.phase) + 1) * 0.15;
        context.fillStyle = `rgba(192,180,255,${alpha})`;
        context.beginPath();
        context.arc(x, y, particle.radius, 0, TAU);
        context.fill();
      }

      // Fine satellite paths give the ribbon volume a larger, airy silhouette.
      context.save();
      context.rotate(-0.32);
      context.lineWidth = 0.65;
      context.strokeStyle = "rgba(163,142,248,0.16)";
      context.beginPath();
      context.ellipse(0, 4, 239, 87, 0, 0, TAU);
      context.stroke();
      context.strokeStyle = "rgba(159,191,238,0.075)";
      context.beginPath();
      context.ellipse(0, 4, 223, 113, 0.18, 0, TAU);
      context.stroke();
      for (let i = 0; i < 3; i += 1) {
        const angle = time * 0.1 + i * 2.18;
        // Short fading arcs let the orbiting lights read as particles in motion.
        context.lineWidth = 1.1;
        for (let segment = 0; segment < 12; segment += 1) {
          context.strokeStyle = `rgba(190,174,255,${(1 - segment / 12) * 0.6})`;
          context.beginPath();
          context.ellipse(
            0,
            4,
            239,
            87,
            0,
            angle - (segment + 1) * 0.026,
            angle - segment * 0.026,
          );
          context.stroke();
        }
        context.fillStyle =
          i === 1 ? "rgba(188,229,255,.9)" : "rgba(193,174,255,.8)";
        context.shadowBlur = 12;
        context.shadowColor = "#ad86ff";
        context.beginPath();
        context.arc(
          Math.cos(angle) * 239,
          Math.sin(angle) * 87 + 4,
          1.8,
          0,
          TAU,
        );
        context.fill();
        context.shadowBlur = 0;
      }
      context.restore();

      const spectrum = context.createLinearGradient(-153, -105, 155, 110);
      spectrum.addColorStop(0, "#b9a5ff");
      spectrum.addColorStop(0.28, "#8a60ff");
      spectrum.addColorStop(0.52, "#dccfff");
      spectrum.addColorStop(0.76, "#8379ff");
      spectrum.addColorStop(1, "#a9e1fa");
      context.strokeStyle = spectrum;
      context.lineJoin = "round";

      // Sample the changing ring once, then share it across all 48 filaments.
      for (let step = 0; step <= STEPS; step += 1) {
        const { angle } = ringSamples[step]!;
        const twist = angle * 2 + time * 0.19;
        tubes[step] = 37 + 6 * Math.sin(angle * 3 + time * 0.23);
        twistCosines[step] = Math.cos(twist);
        twistSines[step] = Math.sin(twist);
      }

      // The braided torus is actual projected geometry, rather than a rotating image.
      // Forty-eight fine filaments create a translucent, silk-like surface.
      for (const filament of filamentSamples) {
        for (let step = 0; step <= STEPS; step += 1) {
          const sample = ringSamples[step]!;
          const tube = tubes[step]!;
          const cosTwist =
            filament.cos * twistCosines[step]! -
            filament.sin * twistSines[step]!;
          const sinTwist =
            filament.sin * twistCosines[step]! +
            filament.cos * twistSines[step]!;
          const radius = 112 + cosTwist * tube;
          const x = sample.cos * radius;
          const y = sample.sin * radius;
          const z = sinTwist * tube;
          const projectedY = y * cosIncline - z * sinIncline;
          const depth = y * sinIncline + z * cosIncline;
          const perspective = 720 / (720 - depth);
          points[step * 2] = (x * cosTilt - projectedY * sinTilt) * perspective;
          points[step * 2 + 1] =
            (x * sinTilt + projectedY * cosTilt) * perspective;
        }
        const { highlight } = filament;
        context.globalAlpha = highlight ? 0.73 : 0.21 + filament.sin * 0.07;
        context.lineWidth = highlight ? 1.15 : 0.68;
        context.shadowBlur = highlight ? 7 : 0;
        context.shadowColor = "rgba(132,93,255,.72)";
        context.beginPath();
        context.moveTo(points[0]!, points[1]!);
        for (let step = 1; step <= STEPS; step += 1) {
          context.lineTo(points[step * 2]!, points[step * 2 + 1]!);
        }
        context.stroke();
      }

      context.globalAlpha = 1;
      context.shadowBlur = 0;
      context.globalCompositeOperation = "source-over";
    };

    const canAnimate = () =>
      width > 0 &&
      height > 0 &&
      !pauseRef.current &&
      !motionQuery.matches &&
      visible &&
      !document.hidden;
    const animate = (now: number) => {
      frame = 0;
      if (!canAnimate()) return;
      // This ambient sculpture needs only 30 fps, including on high-refresh displays.
      if (!lastFrame || now - lastFrame >= FRAME_INTERVAL) {
        elapsed += lastFrame ? Math.min((now - lastFrame) / 1000, 0.08) : 0;
        lastFrame = now;
        draw();
      }
      frame = window.requestAnimationFrame(animate);
    };
    const refresh = () => {
      const active = canAnimate();
      host.dataset.animating = String(active);
      if (!active) {
        window.cancelAnimationFrame(frame);
        frame = 0;
        lastFrame = 0;
      } else if (!frame) {
        frame = window.requestAnimationFrame(animate);
      }
    };
    const resize = () => {
      const bounds = host.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      ratio = Math.min(window.devicePixelRatio || 1, 1.75);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      draw();
      refresh();
    };

    refreshRef.current = refresh;
    const sizeObserver = new ResizeObserver(resize);
    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        visible = Boolean(
          entry?.isIntersecting && entry.intersectionRatio >= 0.05,
        );
        refresh();
      },
      { threshold: 0.05 },
    );
    sizeObserver.observe(host);
    intersectionObserver.observe(host);
    motionQuery.addEventListener("change", refresh);
    document.addEventListener("visibilitychange", refresh);
    resize();
    refresh();

    return () => {
      refreshRef.current = null;
      window.cancelAnimationFrame(frame);
      sizeObserver.disconnect();
      intersectionObserver.disconnect();
      motionQuery.removeEventListener("change", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className={styles.aura}
      aria-hidden="true"
      data-animating="false"
    >
      <div className={styles.halo} />
      <div className={styles.floor} />
      <canvas ref={canvasRef} className={styles.canvas} />
      <div className={styles.core}>
        <Sparkles size={23} strokeWidth={1.15} />
      </div>
      <div className={`${styles.badge} ${styles.imageBadge}`}>
        <span className={styles.badgeIcon}>
          <ImageIcon size={15} strokeWidth={1.6} />
        </span>
        <span>图像生成</span>
        <span className={styles.badgeDot} />
      </div>
      <div className={`${styles.badge} ${styles.videoBadge}`}>
        <span className={styles.badgeIcon}>
          <Video size={15} strokeWidth={1.6} />
        </span>
        <span>视频创作</span>
      </div>
      <div className={`${styles.badge} ${styles.textBadge}`}>
        <span className={styles.badgeIcon}>
          <Type size={14} strokeWidth={1.6} />
        </span>
        <span>文字灵感</span>
      </div>
      <div className={styles.coordinate}>
        <span /> INFINITE POSSIBILITIES
      </div>
    </div>
  );
});
