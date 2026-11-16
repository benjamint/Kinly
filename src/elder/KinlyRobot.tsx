import { useEffect, useId, useRef } from "react";
import { resolveLook, shade, type Accessory, type RobotLook } from "../shared/robotLook";
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
  /** Colours and accessory; defaults from src/shared/robotLook.ts. */
  look?: Partial<RobotLook>;
}

const KENTE = ["#f2b632", "#2f7a3d", "#c0392b", "#1b1b1b"];

/** Swag drawn on the body (under the head). */
function BodyAccessory({ kind, accent }: { kind: Accessory; accent: string }) {
  if (kind === "bowtie") {
    return (
      <g transform="translate(200 322)">
        <path d="M -6 -2 L -34 -16 Q -40 0 -34 16 L -6 2 Z" fill={accent} />
        <path d="M 6 -2 L 34 -16 Q 40 0 34 16 L 6 2 Z" fill={accent} />
        <path d="M -30 -10 L -14 -3 M -30 10 L -14 3 M 30 -10 L 14 -3 M 30 10 L 14 3" stroke={shade(accent, -0.25)} strokeWidth="2" />
        <rect x="-8" y="-9" width="16" height="18" rx="5" fill={shade(accent, -0.18)} />
      </g>
    );
  }
  if (kind === "kente") {
    return (
      <g>
        {/* scarf band around the neck, striped like kente cloth */}
        {KENTE.map((c, i) => (
          <path key={i} d={`M ${141 + i} ${312 + i * 5} Q 200 ${334 + i * 5} ${259 - i} ${312 + i * 5}`} fill="none" stroke={c} strokeWidth="6" />
        ))}
        <g transform="translate(236 330) rotate(12)">
          {KENTE.map((c, i) => (
            <rect key={i} x="0" y={i * 13} width="22" height="13" fill={c} />
          ))}
          <path d="M 0 52 L 4 60 M 8 52 L 8 61 M 14 52 L 13 60 M 20 52 L 18 59" stroke="#f2b632" strokeWidth="2" />
        </g>
      </g>
    );
  }
  if (kind === "beads") {
    return (
      <g>
        {Array.from({ length: 13 }, (_, i) => {
          const t = i / 12;
          const x = 146 + t * 108;
          const y = 314 + Math.sin(t * Math.PI) * 24;
          return <circle key={i} cx={x} cy={y} r={i % 2 ? 5 : 6.5} fill={i % 2 ? "#f2b632" : accent} />;
        })}
      </g>
    );
  }
  return null;
}

/** Swag drawn on the head. */
function HeadAccessory({ kind, accent, shell }: { kind: Accessory; accent: string; shell: string }) {
  if (kind === "kufi") {
    return (
      <g>
        <path d="M 120 186 Q 122 142 200 140 Q 278 142 280 186 Q 200 176 120 186 Z" fill={accent} />
        <path d="M 120 186 Q 200 176 280 186" fill="none" stroke={shade(accent, -0.25)} strokeWidth="4" />
        {Array.from({ length: 9 }, (_, i) => (
          <circle key={i} cx={136 + i * 16} cy={166 - Math.sin((i / 8) * Math.PI) * 12} r="2.6" fill={shade(accent, 0.55)} />
        ))}
      </g>
    );
  }
  if (kind === "headphones") {
    const dark = shade(accent, -0.35);
    return (
      <g>
        <path d="M 104 220 Q 104 150 200 148 Q 296 150 296 220" fill="none" stroke={dark} strokeWidth="9" strokeLinecap="round" />
        <rect x="88" y="200" width="26" height="54" rx="12" fill={accent} />
        <rect x="286" y="200" width="26" height="54" rx="12" fill={accent} />
        <rect x="94" y="208" width="8" height="38" rx="4" fill={shade(accent, 0.35)} />
        <rect x="298" y="208" width="8" height="38" rx="4" fill={shade(accent, 0.35)} />
      </g>
    );
  }
  if (kind === "flower") {
    return (
      <g transform="translate(130 180)">
        {Array.from({ length: 5 }, (_, i) => {
          const a = (i / 5) * Math.PI * 2;
          return <ellipse key={i} cx={Math.cos(a) * 11} cy={Math.sin(a) * 11} rx="11" ry="8" transform={`rotate(${(a * 180) / Math.PI} ${Math.cos(a) * 11} ${Math.sin(a) * 11})`} fill={accent} />;
        })}
        <circle r="7" fill="#f2c14e" stroke={shade(shell, -0.2)} strokeWidth="1" />
      </g>
    );
  }
  return null;
}

export function KinlyRobot({ expression, getVolume, look }: RobotProps) {
  const L = resolveLook(look);
  const uid = useId().replace(/:/g, "");
  const id = (name: string) => `kr-${name}-${uid}`;
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
        <radialGradient id={id("shell")} cx="38%" cy="30%" r="80%">
          <stop offset="0%" stopColor={shade(L.shell, 0.75)} />
          <stop offset="55%" stopColor={L.shell} />
          <stop offset="100%" stopColor={shade(L.shell, -0.12)} />
        </radialGradient>
        <radialGradient id={id("body")} cx="35%" cy="25%" r="85%">
          <stop offset="0%" stopColor={shade(L.shell, 0.75)} />
          <stop offset="60%" stopColor={shade(L.shell, -0.02)} />
          <stop offset="100%" stopColor={shade(L.shell, -0.16)} />
        </radialGradient>
        <radialGradient id={id("lens")} cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor={shade(L.eyes, 0.2)} />
          <stop offset="60%" stopColor={L.eyes} />
          <stop offset="100%" stopColor={shade(L.eyes, -0.7)} />
        </radialGradient>
        <radialGradient id={id("shadow")}>
          <stop offset="0%" stopColor="rgba(0,0,0,0.22)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
        <clipPath id={id("eye-clip")}>
          <circle cx="0" cy="0" r={LENS_R + 4.5} />
        </clipPath>
      </defs>

      <ellipse className="kr__shadow" cx="200" cy="492" rx="108" ry="16" fill={`url(#${id("shadow")})`} />

      <g className="kr__body">
        {/* base: a soft disc */}
        <ellipse cx="200" cy="466" rx="72" ry="18" fill={L.trim} />
        {/* egg body, opening at the top where the head sits */}
        <path
          d="M 142 300 C 122 330 112 372 116 412 C 119 446 148 462 200 462 C 252 462 281 446 284 412 C 288 372 278 330 258 300 Z"
          fill={`url(#${id("body")})`}
        />
        <ellipse cx="200" cy="300" rx="58" ry="11" fill={shade(L.shell, -0.13)} />
        <ellipse cx="200" cy="302" rx="50" ry="8" fill={shade(L.shell, -0.25)} />
        <path d="M 120 420 Q 200 446 280 420" fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth="2" />
        <BodyAccessory kind={L.accessory} accent={L.accent} />
      </g>

      <g className="kr__head">
        <g transform="translate(0 9)">
          {[0, 1].map((i) => (
            <g key={i} className={`kr__ant kr__ant--${i}`} transform={`translate(${i ? 248 : 152} 172)`}>
              <path d={antenna} fill="none" stroke={L.trim} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="-3" y="-148" width="6" height="16" rx="3" fill={L.trim} />
            </g>
          ))}
          <rect x="108" y="168" width="184" height="126" rx="36" fill={`url(#${id("shell")})`} />
          {/* side panel shading for depth */}
          <path d="M 270 172 Q 292 176 292 204 L 292 258 Q 292 290 266 293 Q 284 270 284 232 Q 284 190 270 172 Z" fill="rgba(0,0,0,0.05)" />
          <HeadAccessory kind={L.accessory} accent={L.accent} shell={L.shell} />
          <g className="kr__eyes">
            <rect x="182" y="226" width="36" height="7" rx="3.5" fill={shade(L.eyes, -0.2)} />
            {[0, 1].map((i) => (
              <g key={i} className={`kr__eye kr__eye--${i}`}>
                <g className="kr__lens" transform={`translate(${EYES[i]} ${EYE_Y})`}>
                  <circle r={LENS_R + 4} fill={shade(L.eyes, -0.35)} />
                  <circle r={LENS_R - 3} fill={`url(#${id("lens")})`} />
                  <circle r={LENS_R - 9} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2" />
                  <g className="kr__glint">
                    <circle cx="-7" cy="-8" r="4.5" fill="rgba(255,255,255,0.9)" />
                    <circle cx="6" cy="6" r="2" fill="rgba(255,255,255,0.45)" />
                  </g>
                  {/* eyelid in the shell colour slides down over the eye */}
                  <g clipPath={`url(#${id("eye-clip")})`}>
                    <rect className="kr__lid" x={-LENS_R - 6} y={-LENS_R - 6} width={LENS_R * 2 + 12} height="0" fill={shade(L.shell, 0.15)} />
                  </g>
                  {/* the closed eye: a soft downward curve */}
                  <path className="kr__closed" d={`M ${-LENS_R + 2} 2 Q 0 ${LENS_R * 0.55} ${LENS_R - 2} 2`} fill="none" stroke={L.eyes} strokeWidth="5" strokeLinecap="round" opacity="0" />
                </g>
              </g>
            ))}
          </g>
        </g>
      </g>
    </svg>
  );
}
