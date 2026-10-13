import { useEffect, useRef } from "react";
import type { Expression } from "./expression";

// Kinly's face: two flat, expressive eyes and a pair of lips on warm clay.
// Every feature is a shape described by a few numbers (how open, how
// squinted, pupil size, smile…). Each expression sets target numbers and
// springs pull the shapes towards them, which gives the soft, bouncy
// "motion design" feel. The lips follow the loudness of Kinly's voice.

interface Pose {
  open: number; // upper lid: 0 closed … 1 wide open
  lower: number; // lower lid raise: 0 relaxed … 1 squinting
  pupil: number; // pupil radius
  sad: number; // outer part of the upper lid droops
  lookX: number; // -1 … 1
  lookY: number; // -1 … 1
  smile: number; // -1 frown … 1 smile
  width: number; // mouth width multiplier
  part: number; // lips parted at rest: 0 closed … ~0.3 a hint of teeth
}

const POSES: Record<Expression, Pose> = {
  idle: { open: 0.6, lower: 0.36, pupil: 27, sad: 0, lookX: 0, lookY: 0.05, smile: 0.9, width: 1.1, part: 0.3 },
  listening: { open: 0.95, lower: 0.12, pupil: 29, sad: 0, lookX: 0, lookY: -0.05, smile: 0.5, width: 1, part: 0.08 },
  thinking: { open: 0.5, lower: 0.55, pupil: 15, sad: 0, lookX: 0.6, lookY: -0.55, smile: 0.1, width: 0.78, part: 0 },
  speaking: { open: 0.72, lower: 0.4, pupil: 26, sad: 0, lookX: 0, lookY: 0.05, smile: 0.6, width: 1.04, part: 0.1 },
  concerned: { open: 0.82, lower: 0.12, pupil: 27, sad: 1, lookX: 0, lookY: 0.1, smile: -0.55, width: 0.85, part: 0 },
  sleeping: { open: 0, lower: 0.2, pupil: 24, sad: 0, lookX: 0, lookY: 0.3, smile: 0.45, width: 0.95, part: 0 },
};

/** Little moments of life while idle, borrowed from the reference animation. */
const GESTURES: { pose: Partial<Pose>; ms: number }[] = [
  { pose: { lookX: -0.7, lookY: 0.1 }, ms: 1300 }, // glance
  { pose: { lookX: 0.7, lookY: 0 }, ms: 1300 },
  { pose: { open: 0.98, lower: 0.05, pupil: 31, lookY: -0.15 }, ms: 900 }, // curious, wide
  { pose: { open: 0.48, lower: 0.6, pupil: 14, lookX: 0.35 }, ms: 1000 }, // narrow, playful squint
  { pose: { lower: 0.5, smile: 1.15, width: 1.18, part: 0.32 }, ms: 1300 }, // big warm smile
];

type Key = keyof Pose;
const KEYS = Object.keys(POSES.idle) as Key[];

// Eye geometry (local units, eye centred on 0,0).
const EYE_HALF = 66;

function eyePaths(p: Pose, blink: number) {
  const open = p.open * (1 - blink);
  const lowH = 30 * (1 - p.lower) + 4; // depth of the lower lid curve
  // Height of the upper lid curve. At open = 0 it lies just above the lower
  // lid, so the eye closes into a downward curve rather than a slit.
  const upH = -lowH * 0.9 + (64 + lowH * 0.9) * Math.max(0, open);
  const sadDrop = p.sad * Math.max(0, upH) * 0.8;
  const w = EYE_HALF;
  // In eye-local units +x points towards the nose for both eyes (the right eye
  // is mirrored). Upper lid runs from the outer corner (-w) to the inner (+w);
  // sadness droops the outer part.
  const upper = `M ${-w} ${sadDrop * 0.25} C ${-w * 0.62} ${-upH * 1.05 + sadDrop} ${w * 0.45} ${-upH * 1.12} ${w} 0`;
  const lower = `C ${w * 0.55} ${lowH} ${-w * 0.6} ${lowH * 1.05} ${-w} ${sadDrop * 0.25} Z`;
  return { shape: `${upper} ${lower}`, closedness: 1 - Math.min(1, Math.max(0, upH + lowH) / 22), lowH, upH };
}

function mouthPaths(p: Pose, open: number) {
  const w = 62 * p.width;
  const cy = -p.smile * 11; // corners rise when smiling
  const mid = p.smile * 5; // middle sits lower than the corners when smiling
  const gap = open * 36;
  // A smile stretches the upper lip thinner and lifts it with the corners.
  const lift = Math.max(0, p.smile) * 6;
  const peak = -19 + lift;
  const upperOuter =
    `M ${-w} ${cy} C ${-w * 0.6} ${cy - 9 + lift * 0.3} ${-w * 0.32} ${peak - 1} ${-w * 0.14} ${peak} ` +
    `Q 0 ${peak + 6} ${w * 0.14} ${peak} C ${w * 0.32} ${peak - 1} ${w * 0.6} ${cy - 9 + lift * 0.3} ${w} ${cy}`;
  const innerTopR = `C ${w * 0.5} ${mid - open * 7} ${-w * 0.5} ${mid - open * 7} ${-w} ${cy}`;
  const innerTop = `M ${-w} ${cy} C ${-w * 0.5} ${mid - open * 7} ${w * 0.5} ${mid - open * 7} ${w} ${cy}`;
  const innerBottom = `C ${w * 0.5} ${mid + gap} ${-w * 0.5} ${mid + gap} ${-w} ${cy}`;
  const lowerOuter = `M ${-w} ${cy} C ${-w * 0.55} ${mid + gap + 24} ${w * 0.55} ${mid + gap + 24} ${w} ${cy}`;
  return {
    upperLip: `${upperOuter} ${innerTopR} Z`,
    interior: `${innerTop} ${innerBottom} Z`,
    lowerLip: `${lowerOuter} ${innerBottom} Z`,
    teethY: mid - open * 7,
    gap,
  };
}

interface FaceProps {
  expression: Expression;
  /** 0–1 loudness of Kinly's voice, polled every frame. */
  getVolume: () => number;
}

export function KinlyFace({ expression, getVolume }: FaceProps) {
  const root = useRef<SVGSVGElement>(null);
  const state = useRef({ expression, getVolume });
  state.current = { expression, getVolume };

  useEffect(() => {
    const svg = root.current!;
    const q = <T extends Element>(sel: string) => svg.querySelector(sel) as T;
    const els = {
      face: q<SVGGElement>(".kf__face"),
      eyes: [0, 1].map((i) => ({
        shape: q<SVGPathElement>(`.kf__eye--${i} .kf__sclera`),
        clip: q<SVGPathElement>(`#kf-clip-${i} path`),
        pupil: q<SVGCircleElement>(`.kf__eye--${i} .kf__pupil`),
        shine: q<SVGCircleElement>(`.kf__eye--${i} .kf__shine`),
        closed: q<SVGPathElement>(`.kf__eye--${i} .kf__closed`),
        ticks: q<SVGGElement>(`.kf__eye--${i} .kf__ticks`),
      })),
      upperLip: q<SVGPathElement>(".kf__lip--upper"),
      lowerLip: q<SVGPathElement>(".kf__lip--lower"),
      interior: q<SVGPathElement>(".kf__interior"),
      mouthClip: q<SVGPathElement>("#kf-mouth-clip path"),
      teeth: q<SVGRectElement>(".kf__teeth"),
      tongue: q<SVGEllipseElement>(".kf__tongue"),
    };

    const cur = { ...POSES.idle } as Pose;
    const vel = Object.fromEntries(KEYS.map((k) => [k, 0])) as Record<Key, number>;
    let mouth = 0;
    let mouthVel = 0;
    let gesture: { pose: Partial<Pose>; until: number } | null = null;
    let nextGesture = performance.now() + 3000;
    let blinkStart = -1;
    let nextBlink = performance.now() + 2200;
    let last = performance.now();
    let raf = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      const { expression, getVolume } = state.current;

      // Target pose, with an idle gesture layered on top now and then.
      const target: Pose = { ...POSES[expression] };
      if (expression === "idle") {
        if (!gesture && now > nextGesture) {
          const g = GESTURES[Math.floor(Math.random() * GESTURES.length)];
          gesture = { pose: g.pose, until: now + g.ms };
        }
        if (gesture && now > gesture.until) {
          gesture = null;
          nextGesture = now + 3500 + Math.random() * 4500;
        }
        if (gesture) Object.assign(target, gesture.pose);
      } else {
        gesture = null;
      }
      if (expression === "speaking") {
        // talk with the eyes a little too
        target.lookX += Math.sin(t * 0.9) * 0.18;
        target.lower += Math.sin(t * 2.1) * 0.05;
      }

      // Springs: a touch of overshoot gives the bouncy feel.
      for (const k of KEYS) {
        const stiffness = k === "lookX" || k === "lookY" ? 120 : 160;
        const damping = k === "lookX" || k === "lookY" ? 14 : 15;
        vel[k] += ((target[k] - cur[k]) * stiffness - vel[k] * damping) * dt;
        cur[k] += vel[k] * dt;
      }

      // Lips follow the voice, with varying width so syllables look different.
      const vol = Math.max(cur.part, expression === "speaking" ? Math.min(1, getVolume() * 1.7) : 0);
      mouthVel += ((vol - mouth) * 900 - mouthVel * 45) * dt;
      mouth = Math.max(0, mouth + mouthVel * dt);
      const syllable = expression === "speaking" ? Math.sin(t * 7.3) * 0.07 + Math.sin(t * 3.1) * 0.05 : 0;
      const lips: Pose = { ...cur, width: cur.width * (1 - mouth * 0.22) + syllable };

      // Blinks (skipped while asleep, eyes are closed already).
      if (expression !== "sleeping" && blinkStart < 0 && now > nextBlink) blinkStart = now;
      let blink = 0;
      if (blinkStart >= 0) {
        const p = (now - blinkStart) / 190;
        blink = p < 0.4 ? p / 0.4 : p < 1 ? 1 - (p - 0.4) / 0.6 : 0;
        if (p >= 1) {
          blinkStart = -1;
          nextBlink = now + 2400 + Math.random() * 3800;
          if (Math.random() < 0.2) nextBlink = now + 220; // the occasional double blink
        }
      }

      // Gentle float of the whole face.
      const floatY = Math.sin(t * 1.1) * 3 + (expression === "listening" ? -4 : 0);
      const tilt = Math.sin(t * 0.5) * 1.2 + (expression === "thinking" ? 4 : 0);
      els.face.setAttribute("transform", `translate(200 ${210 + floatY}) rotate(${tilt})`);

      // Eyes (the right eye is mirrored, so its look direction is flipped).
      els.eyes.forEach((e, i) => {
        const pose = { ...cur, lookX: i === 0 ? cur.lookX : -cur.lookX };
        const { shape, closedness, lowH, upH } = eyePaths(pose, blink);
        e.shape.setAttribute("d", shape);
        e.clip.setAttribute("d", shape);
        const px = pose.lookX * 30;
        const py = pose.lookY * 16 + (lowH - upH) * 0.12;
        e.pupil.setAttribute("cx", px.toFixed(2));
        e.pupil.setAttribute("cy", py.toFixed(2));
        e.pupil.setAttribute("r", Math.max(4, cur.pupil).toFixed(2));
        e.shine.setAttribute("cx", (px + cur.pupil * 0.38).toFixed(2));
        e.shine.setAttribute("cy", (py - cur.pupil * 0.4).toFixed(2));
        e.shine.setAttribute("r", Math.max(1.5, cur.pupil * 0.2).toFixed(2));
        const shut = Math.max(0, Math.min(1, closedness * 1.3));
        e.closed.style.opacity = shut.toFixed(2);
        e.pupil.style.opacity = e.shine.style.opacity = (1 - shut).toFixed(2);
        e.ticks.setAttribute("transform", `translate(0 ${lowH * 0.9})`);
        e.ticks.style.opacity = (0.25 + cur.lower * 0.6).toFixed(2);
      });

      // Lips.
      const m = mouthPaths(lips, mouth);
      els.upperLip.setAttribute("d", m.upperLip);
      els.lowerLip.setAttribute("d", m.lowerLip);
      els.interior.setAttribute("d", m.interior);
      els.mouthClip.setAttribute("d", m.interior);
      els.teeth.setAttribute("y", (m.teethY - 3).toFixed(2));
      els.teeth.setAttribute("height", Math.max(0, Math.min(11, 3 + m.gap * 0.55)).toFixed(2));
      els.tongue.setAttribute("cy", (m.teethY + m.gap + 4).toFixed(2));
      els.tongue.setAttribute("ry", Math.max(0, m.gap * 0.42).toFixed(2));
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const eye = (i: number) => (
    <g className={`kf__eye kf__eye--${i}`} transform={i === 0 ? "translate(-82 0) rotate(-6)" : "translate(82 0) scale(-1 1) rotate(-6)"}>
      <clipPath id={`kf-clip-${i}`}>
        <path />
      </clipPath>
      <path className="kf__sclera" />
      <g clipPath={`url(#kf-clip-${i})`}>
        <circle className="kf__pupil" r="26" />
        <circle className="kf__shine" r="5" />
      </g>
      <path className="kf__closed" d={`M ${-EYE_HALF + 6} 2 Q 0 22 ${EYE_HALF - 6} 2`} />
      <g className="kf__ticks">
        <path d="M -52 14 Q -40 24 -24 28" />
        <path d="M -4 32 Q 14 32 30 28" />
      </g>
    </g>
  );

  return (
    <svg ref={root} className="kinly-face" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Kinly, your AI assistant">
      <g className="kf__face">
        <g transform="translate(0 -36)">
          {eye(0)}
          {eye(1)}
        </g>
        <g className="kf__mouth" transform="translate(0 86)">
          <clipPath id="kf-mouth-clip">
            <path />
          </clipPath>
          <path className="kf__interior" />
          <g clipPath="url(#kf-mouth-clip)">
            <rect className="kf__teeth" x="-44" width="88" rx="3" />
            <ellipse className="kf__tongue" cx="0" rx="26" />
          </g>
          <path className="kf__lip kf__lip--upper" />
          <path className="kf__lip kf__lip--lower" />
        </g>
      </g>
    </svg>
  );
}
