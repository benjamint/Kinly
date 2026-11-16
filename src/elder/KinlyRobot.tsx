import { useEffect, useRef } from "react";
import type { Expression } from "./expression";

// Kinly, a small friendly robot: a glossy white head with two black lens
// eyes, two springy antennas and an egg-shaped body. No mouth: it shows
// feeling with its head, eyes and antennas, which keeps it clearly a
// machine (the PRD's honesty rule) while staying warm.
//
// Each mood sets target numbers; fixed-step springs pull the pose towards
// them, so motion is soft and a little bouncy, and stable on slow devices.

interface Pose {
  tilt: number; // head roll, degrees (negative = towards the left)
  dip: number; // head drop, px (negative = lifted)
  lookX: number; // -1 … 1, eyes/head turn
  lookY: number; // -1 … 1
  eye: number; // lens size multiplier
  antL: number; // antenna angle, degrees (negative = outwards)
  antR: number;
  lid: number; // 0 open … 1 closed (held, e.g. sleeping)
}

const POSES: Record<Expression, Pose> = {
  idle: { tilt: 0, dip: 0, lookX: 0, lookY: 0, eye: 1, antL: -5, antR: 5, lid: 0 },
  listening: { tilt: -7, dip: -6, lookX: -0.1, lookY: -0.1, eye: 1.08, antL: -1, antR: 1, lid: 0 },
  thinking: { tilt: 8, dip: 0, lookX: 0.65, lookY: -0.6, eye: 0.95, antL: -9, antR: 12, lid: 0.15 },
  speaking: { tilt: -2, dip: 0, lookX: 0, lookY: 0, eye: 1.02, antL: -4, antR: 4, lid: 0 },
  concerned: { tilt: -5, dip: 10, lookX: 0, lookY: 0.4, eye: 1.05, antL: -26, antR: 26, lid: 0.12 },
  sleeping: { tilt: 4, dip: 14, lookX: 0, lookY: 0.5, eye: 1, antL: -20, antR: 20, lid: 1 },
};

/** Small moments of life while idle. */
const GESTURES: { pose: Partial<Pose>; ms: number }[] = [
  { pose: { lookX: -0.75, tilt: -3 }, ms: 1500 },
  { pose: { lookX: 0.75, tilt: 3 }, ms: 1500 },
  { pose: { tilt: 9, antL: -12, antR: 2 }, ms: 1300 }, // curious head tilt
  { pose: { dip: -6, eye: 1.08, antL: 0, antR: 0 }, ms: 1000 }, // perk up
  { pose: { lookY: -0.6, lookX: 0.3 }, ms: 1200 }, // glance up
];

type Key = keyof Pose;
const KEYS = Object.keys(POSES.idle) as Key[];
const STEP = 1 / 240;

// Geometry (viewBox 0 0 400 520).
const NECK = { x: 200, y: 300 };
const EYES = [162, 238];
const EYE_Y = 230;
const LENS_R = 25;

function antennaPath(): string {
  // a thin rod with a coiled spring near its base, drawn upwards from (0,0)
  let d = "M 0 0 L 0 -12 ";
  for (let i = 0; i < 11; i++) {
    const y = -12 - i * 3.2;
    d += `L ${i % 2 ? -4 : 4} ${(y - 1.6).toFixed(1)} `;
  }
  d += "L 0 -50 L 0 -136";
  return d;
}

interface RobotProps {
  expression: Expression;
  /** 0–1 loudness of Kinly's voice, polled every frame. */
  getVolume: () => number;
}

export function KinlyRobot({ expression, getVolume }: RobotProps) {
  const root = useRef<SVGSVGElement>(null);
  const state = useRef({ expression, getVolume });
  state.current = { expression, getVolume };

  useEffect(() => {
    const svg = root.current!;
    const q = <T extends Element>(sel: string) => svg.querySelector(sel) as T;
    const head = q<SVGGElement>(".kr__head");
    const body = q<SVGGElement>(".kr__body");
    const shadow = q<SVGEllipseElement>(".kr__shadow");
    const eyesGroup = q<SVGGElement>(".kr__eyes");
    const lenses = [0, 1].map((i) => q<SVGGElement>(`.kr__eye--${i} .kr__lens`));
    const glints = [0, 1].map((i) => q<SVGGElement>(`.kr__eye--${i} .kr__glint`));
    const lids = [0, 1].map((i) => q<SVGRectElement>(`.kr__eye--${i} .kr__lid`));
    const closedLines = [0, 1].map((i) => q<SVGPathElement>(`.kr__eye--${i} .kr__closed`));
    const ants = [0, 1].map((i) => q<SVGGElement>(`.kr__ant--${i}`));

    const cur = { ...POSES.idle } as Pose;
    const vel = Object.fromEntries(KEYS.map((k) => [k, 0])) as Record<Key, number>;
    let voice = 0;
    let voiceVel = 0;
    let gesture: { pose: Partial<Pose>; until: number } | null = null;
    let nextGesture = performance.now() + 2500;
    let blinkStart = -1;
    let nextBlink = performance.now() + 2800;
    let last = performance.now();
    let raf = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      const { expression, getVolume } = state.current;

      const target: Pose = { ...POSES[expression] };
      if (expression === "idle") {
        if (!gesture && now > nextGesture) {
          const g = GESTURES[Math.floor(Math.random() * GESTURES.length)];
          gesture = { pose: g.pose, until: now + g.ms };
        }
        if (gesture && now > gesture.until) {
          gesture = null;
          nextGesture = now + 3000 + Math.random() * 4000;
        }
        if (gesture) Object.assign(target, gesture.pose);
      } else gesture = null;

      const vol = expression === "speaking" ? Math.min(1, getVolume() * 1.8) : 0;
      if (expression === "speaking") {
        target.tilt += Math.sin(t * 1.3) * 3;
        target.lookX += Math.sin(t * 0.8) * 0.2;
      }
      if (expression === "thinking") {
        // antennas twitch in turn, like it's working something out
        target.antL += Math.sin(t * 6) * 4;
        target.antR += Math.sin(t * 6 + Math.PI) * 4;
      }

      for (let left = dt; left > 0; left -= STEP) {
        const h = Math.min(STEP, left);
        for (const k of KEYS) {
          const ant = k === "antL" || k === "antR";
          const stiff = ant ? 90 : 120;
          const damp = ant ? 7 : 14; // antennas are springier
          vel[k] += ((target[k] - cur[k]) * stiff - vel[k] * damp) * h;
          cur[k] += vel[k] * h;
        }
        voiceVel += ((vol - voice) * 500 - voiceVel * 30) * h;
        voice += voiceVel * h;
      }

      // Blinks (not while asleep: the lids are already down).
      if (expression !== "sleeping" && blinkStart < 0 && now > nextBlink) blinkStart = now;
      let blink = 0;
      if (blinkStart >= 0) {
        const p = (now - blinkStart) / 220;
        blink = p < 0.45 ? p / 0.45 : p < 1 ? 1 - (p - 0.45) / 0.55 : 0;
        if (p >= 1) {
          blinkStart = -1;
          nextBlink = now + 2800 + Math.random() * 4000;
          if (Math.random() < 0.2) nextBlink = now + 260;
        }
      }

      const breathe = Math.sin(t * 1.4);
      const bob = -voice * 7 + breathe * 1.5;
      const bounce = voice * 9;

      // Head: rolls around the neck, dips and lifts, turns a little with the look.
      head.setAttribute(
        "transform",
        `translate(${(cur.lookX * 5).toFixed(2)} ${(cur.dip + bob).toFixed(2)}) rotate(${cur.tilt.toFixed(2)} ${NECK.x} ${NECK.y})`,
      );
      body.setAttribute("transform", `translate(0 ${(breathe * 0.8).toFixed(2)})`);
      shadow.setAttribute("rx", (108 + breathe * 2).toFixed(2));

      // Eyes slide towards the look direction (the head "turns"), lenses grow when attentive.
      eyesGroup.setAttribute("transform", `translate(${(cur.lookX * 12).toFixed(2)} ${(cur.lookY * 6).toFixed(2)})`);
      const lid = Math.max(cur.lid, blink);
      lenses.forEach((g, i) => {
        g.setAttribute("transform", `translate(${EYES[i]} ${EYE_Y}) scale(${cur.eye.toFixed(3)})`);
        glints[i].setAttribute("transform", `translate(${(cur.lookX * 6).toFixed(2)} ${(cur.lookY * 5).toFixed(2)})`);
        const shut = Math.max(0, Math.min(1, lid));
        lids[i].setAttribute("height", (shut * (LENS_R * 2 + 12)).toFixed(2));
        closedLines[i].setAttribute("opacity", Math.max(0, (shut - 0.75) * 4).toFixed(2));
      });

      // Antennas: pose angle, plus a springy bounce when speaking.
      ants[0].setAttribute("transform", `translate(152 172) rotate(${(cur.antL - bounce * Math.max(0, Math.sin(t * 9))).toFixed(2)})`);
      ants[1].setAttribute("transform", `translate(248 172) rotate(${(cur.antR + bounce * Math.max(0, Math.sin(t * 9 + 1.2))).toFixed(2)})`);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const antenna = antennaPath();
  return (
    <svg
      ref={root}
      className={`kinly-robot kinly-robot--${expression}`}
      viewBox="0 0 400 520"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Kinly, your AI assistant"
    >
      <defs>
        <radialGradient id="kr-shell" cx="38%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="55%" stopColor="#f3f3f2" />
          <stop offset="100%" stopColor="#d9d9d7" />
        </radialGradient>
        <radialGradient id="kr-body" cx="35%" cy="25%" r="85%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="60%" stopColor="#efefed" />
          <stop offset="100%" stopColor="#cfcfcc" />
        </radialGradient>
        <radialGradient id="kr-lens" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#3a3a3c" />
          <stop offset="60%" stopColor="#141416" />
          <stop offset="100%" stopColor="#050506" />
        </radialGradient>
        <radialGradient id="kr-shadow">
          <stop offset="0%" stopColor="rgba(0,0,0,0.22)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
        <clipPath id="kr-eye-clip">
          <circle cx="0" cy="0" r={LENS_R + 4.5} />
        </clipPath>
      </defs>

      <ellipse className="kr__shadow" cx="200" cy="492" rx="108" ry="16" fill="url(#kr-shadow)" />

      <g className="kr__body">
        {/* base: a soft black disc */}
        <ellipse cx="200" cy="466" rx="72" ry="18" fill="#141414" />
        {/* egg body, opening at the top where the head sits */}
        <path
          d="M 142 300 C 122 330 112 372 116 412 C 119 446 148 462 200 462 C 252 462 281 446 284 412 C 288 372 278 330 258 300 Z"
          fill="url(#kr-body)"
        />
        <ellipse cx="200" cy="300" rx="58" ry="11" fill="#d5d4d1" />
        <ellipse cx="200" cy="302" rx="50" ry="8" fill="#b9b8b5" />
        <path d="M 120 420 Q 200 446 280 420" fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth="2" />
      </g>

      <g className="kr__head">
       <g transform="translate(0 9)">
        {[0, 1].map((i) => (
          <g key={i} className={`kr__ant kr__ant--${i}`} transform={`translate(${i ? 248 : 152} 172)`}>
            <path d={antenna} fill="none" stroke="#1c1c1c" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="-3" y="-148" width="6" height="16" rx="3" fill="#1c1c1c" />
          </g>
        ))}
        <rect x="108" y="168" width="184" height="126" rx="36" fill="url(#kr-shell)" />
        {/* side panel shading for depth */}
        <path d="M 270 172 Q 292 176 292 204 L 292 258 Q 292 290 266 293 Q 284 270 284 232 Q 284 190 270 172 Z" fill="rgba(0,0,0,0.05)" />
        <g className="kr__eyes">
          <rect x="182" y="226" width="36" height="7" rx="3.5" fill="#111" />
          {[0, 1].map((i) => (
            <g key={i} className={`kr__eye kr__eye--${i}`}>
              <g className="kr__lens" transform={`translate(${EYES[i]} ${EYE_Y})`}>
                <circle r={LENS_R + 4} fill="#0c0c0d" />
                <circle r={LENS_R - 3} fill="url(#kr-lens)" />
                <circle r={LENS_R - 9} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2" />
                <g className="kr__glint">
                  <circle cx="-7" cy="-8" r="4.5" fill="rgba(255,255,255,0.9)" />
                  <circle cx="6" cy="6" r="2" fill="rgba(255,255,255,0.45)" />
                </g>
                {/* eyelid in the shell colour slides down over the eye */}
                <g clipPath="url(#kr-eye-clip)">
                  <rect className="kr__lid" x={-LENS_R - 6} y={-LENS_R - 6} width={LENS_R * 2 + 12} height="0" fill="#eeeeec" />
                </g>
                {/* the closed eye: a soft downward curve */}
                <path className="kr__closed" d={`M ${-LENS_R + 2} 2 Q 0 ${LENS_R * 0.55} ${LENS_R - 2} 2`} fill="none" stroke="#141414" strokeWidth="5" strokeLinecap="round" opacity="0" />
              </g>
            </g>
          ))}
        </g>
       </g>
      </g>
    </svg>
  );
}
