import { useEffect, useRef } from "react";
import type { Expression } from "./expression";

// Kinly's face: a single portrait brought to life on a canvas.
//  - talking: the lower lip and jaw drop with the loudness of the voice,
//    opening a dark gap under the upper teeth
//  - blinking: eyelids painted in the skin tone sampled just above each eye
//  - idle: slow breathing and a gentle sway; listening leans in a little
//  - sleeping: eyes closed and the picture dimmed
// Movement is kept small on purpose: subtle reads as alive, big reads as uncanny.

const SRC = "/kinly-portrait.jpg";

/** Landmarks measured on the 1254×1254 original; scaled to the loaded image. */
const BASE = 1254;
const FACE_CENTER = { x: 690, y: 500 };
const PIVOT = { x: 660, y: 900 }; // base of the neck: head sways around here
const EYES = [
  { cx: 604, cy: 387, rx: 47, ry: 16, rot: (16 * Math.PI) / 180 },
  { cx: 797, cy: 440, rx: 46, ry: 13, rot: (4 * Math.PI) / 180 },
];
/** Line between the upper teeth and the lower lip, left to right. */
const MOUTH_LINE: [number, number][] = [
  [560, 550],
  [580, 570],
  [600, 583],
  [625, 594],
  [650, 603],
  [680, 607],
  [705, 606],
  [725, 601],
  [748, 593],
];
const JAW_BOTTOM = 735; // below the chin; nothing under this moves
const MAX_DROP = 12; // jaw drop at full volume, in original pixels

function mouthY(x: number): number {
  for (let i = 1; i < MOUTH_LINE.length; i++) {
    const [x0, y0] = MOUTH_LINE[i - 1];
    const [x1, y1] = MOUTH_LINE[i];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return MOUTH_LINE[MOUTH_LINE.length - 1][1];
}

interface Lid {
  top: string;
  bottom: string;
}

/** Skin colours just above and below each eye, for painting eyelids. */
function sampleLids(img: HTMLImageElement, k: number): Lid[] {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const avg = (x: number, y: number) => {
    const d = g.getImageData(Math.round((x - 6) * k), Math.round((y - 3) * k), Math.round(12 * k), Math.round(6 * k)).data;
    let r = 0, gr = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i];
      gr += d[i + 1];
      b += d[i + 2];
    }
    const n = d.length / 4;
    return `rgb(${Math.round(r / n)},${Math.round(gr / n)},${Math.round(b / n)})`;
  };
  return EYES.map((e) => ({
    top: avg(e.cx + Math.sin(e.rot) * (e.ry + 10), e.cy - Math.cos(e.rot) * (e.ry + 10)),
    bottom: avg(e.cx - Math.sin(e.rot) * (e.ry + 8), e.cy + Math.cos(e.rot) * (e.ry + 8)),
  }));
}

interface PortraitProps {
  expression: Expression;
  /** 0–1 voice loudness, polled every frame. */
  getVolume: () => number;
}

export function Portrait({ expression, getVolume }: PortraitProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = useRef({ expression, getVolume });
  state.current = { expression, getVolume };

  useEffect(() => {
    const cv = canvas.current!;
    const ctx = cv.getContext("2d")!;
    const img = new Image();
    img.src = SRC;
    let raf = 0;
    let lids: Lid[] = [];
    let k = 1;

    // Smoothed animation values.
    let jaw = 0;
    let lean = 0;
    let closed = 0;
    let dim = 0;
    let nextBlink = performance.now() + 2500;
    let blinkStart = -1;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = cv.getBoundingClientRect();
      cv.width = Math.max(1, Math.round(width * dpr));
      cv.height = Math.max(1, Math.round(height * dpr));
    };
    const ro = new ResizeObserver(resize);
    ro.observe(cv);
    resize();

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!img.complete || !img.naturalWidth) return;
      const { expression, getVolume } = state.current;
      const t = now / 1000;
      const W = cv.width;
      const H = cv.height;

      // --- targets for this frame
      const speaking = expression === "speaking";
      const sleeping = expression === "sleeping";
      const vol = speaking ? Math.min(1, getVolume() * 1.8) : 0;
      jaw += (vol - jaw) * (vol > jaw ? 0.55 : 0.3);
      lean += ((expression === "listening" ? 1 : 0) - lean) * 0.06;
      dim += ((sleeping ? 1 : 0) - dim) * 0.04;

      // Blinks every 2.5–6 s, 140 ms each; held shut when sleeping.
      if (!sleeping && blinkStart < 0 && now > nextBlink) blinkStart = now;
      let blink = 0;
      if (blinkStart >= 0) {
        const p = (now - blinkStart) / 140;
        blink = p < 1 ? Math.sin(Math.PI * p) : 0;
        if (p >= 1) {
          blinkStart = -1;
          nextBlink = now + 2500 + Math.random() * 3500;
        }
      }
      closed += ((sleeping ? 1 : 0) - closed) * 0.05;
      const lidClose = Math.max(blink, closed);

      // --- camera: cover the canvas, keep the face centred, gentle life-like motion
      const iw = BASE;
      const zoom = 1.04 + lean * 0.035; // slight overscan hides edges when swaying
      const s = Math.max(W / iw, H / iw) * zoom;
      const ox = Math.min(0, Math.max(W - iw * s, W / 2 - FACE_CENTER.x * s));
      const oy = Math.min(0, Math.max(H - iw * s, H * 0.45 - FACE_CENTER.y * s));
      const sway = Math.sin(t * 0.45) * 0.008 + Math.sin(t * 0.17) * 0.006 + jaw * 0.004;
      const breathe = 1 + Math.sin(t * 1.25) * 0.004;
      const nod = speaking ? Math.sin(t * 5.3) * jaw * 2 : 0;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#2b1d14";
      ctx.fillRect(0, 0, W, H);
      ctx.setTransform(s, 0, 0, s, ox, oy);
      ctx.translate(PIVOT.x, PIVOT.y);
      ctx.rotate(sway);
      ctx.scale(breathe, breathe);
      ctx.translate(-PIVOT.x, -PIVOT.y + nod);

      // Draw in original-image units; the source rect is scaled by k.
      ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, iw, iw);

      // --- mouth: drop everything between the mouth line and the jaw, column by column
      const drop = jaw * MAX_DROP;
      if (drop > 0.3) {
        const x0 = MOUTH_LINE[0][0];
        const x1 = MOUTH_LINE[MOUTH_LINE.length - 1][0];
        const step = 1;
        const falloff = (x: number) => Math.pow(Math.sin((Math.PI * (x - x0)) / (x1 - x0)), 0.8);
        ctx.save();
        ctx.imageSmoothingQuality = "high";
        // Mouth interior behind the lower lip: deep red-brown, darker under the teeth.
        ctx.beginPath();
        for (let x = x0; x <= x1; x += 2) ctx.lineTo(x, mouthY(x) - 1.5);
        for (let x = x1; x >= x0; x -= 2) ctx.lineTo(x, mouthY(x) + drop * falloff(x) + 2);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, 590, 0, 590 + MAX_DROP);
        grad.addColorStop(0, "#1f0b0a");
        grad.addColorStop(1, "#5a2420");
        ctx.fillStyle = grad;
        ctx.filter = "blur(0.8px)";
        ctx.fill();
        ctx.filter = "none";
        // Lower lip and chin, moved down and squeezed into the space below.
        for (let x = x0; x < x1; x += step) {
          const d = drop * falloff(x + step / 2);
          if (d < 0.15) continue;
          const y = mouthY(x + step / 2);
          ctx.drawImage(img, x * k, y * k, step * k, (JAW_BOTTOM - y) * k, x - 0.25, y + d, step + 0.5, JAW_BOTTOM - y - d);
        }
        // Soft shadow where the upper teeth meet the opening.
        ctx.beginPath();
        for (let x = x0; x <= x1; x += 2) ctx.lineTo(x, mouthY(x) - 2);
        for (let x = x1; x >= x0; x -= 2) ctx.lineTo(x, mouthY(x) + 1.5 * falloff(x));
        ctx.closePath();
        ctx.fillStyle = `rgba(40,15,12,${0.35 * jaw})`;
        ctx.filter = "blur(1.2px)";
        ctx.fill();
        ctx.filter = "none";
        ctx.restore();
      }

      // --- eyelids: skin-toned lid that slides down over the eye opening,
      // with a curved lash line at its lower edge
      if (lidClose > 0.02 && lids.length) {
        EYES.forEach((e, i) => {
          const rx = e.rx + 3;
          const ry = e.ry + 3;
          // lower edge of the lid: from the top of the eye (open) to just below centre (closed)
          const edge = -ry + (ry * 1.85) * lidClose;
          const sag = 4 + 6 * lidClose; // a closed eye curves gently downward
          ctx.save();
          ctx.translate(e.cx, e.cy);
          ctx.rotate(e.rot);
          ctx.beginPath();
          ctx.moveTo(-rx, 0);
          ctx.ellipse(0, 0, rx, ry + 2, 0, Math.PI, 0, false); // over the top of the eye
          ctx.quadraticCurveTo(0, edge + sag, -rx, 0); // back along the lid edge
          ctx.closePath();
          const g = ctx.createLinearGradient(0, -ry, 0, ry);
          g.addColorStop(0, lids[i].top);
          g.addColorStop(1, lids[i].bottom);
          ctx.fillStyle = g;
          ctx.filter = "blur(1px)";
          ctx.fill();
          ctx.filter = "none";
          // crease shading just above the lid edge
          ctx.strokeStyle = `rgba(60,30,20,${0.25 * lidClose})`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(-rx * 0.85, -2);
          ctx.quadraticCurveTo(0, edge + sag - 7, rx * 0.85, -2);
          ctx.stroke();
          // lashes
          ctx.strokeStyle = `rgba(25,14,10,${0.6 + 0.35 * lidClose})`;
          ctx.lineWidth = 2.6;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(-rx * 0.95, 1);
          ctx.quadraticCurveTo(0, edge + sag + 1, rx * 0.95, 1);
          ctx.stroke();
          ctx.restore();
        });
      }

      // --- night: dim the room
      if (dim > 0.01) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = `rgba(12,14,30,${0.55 * dim})`;
        ctx.fillRect(0, 0, W, H);
      }
    };

    img.onload = () => {
      k = img.naturalWidth / BASE;
      lids = sampleLids(img, k);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvas} className="portrait" role="img" aria-label="Kinly, your AI assistant" />;
}
