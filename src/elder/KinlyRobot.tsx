import { useEffect, useId, useRef } from "react";
import { resolveLook, shade, type Accessory, type RobotLook } from "../shared/robotLook";
import type { Expression } from "./expression";

// Kinly, a small friendly robot: a glossy white head with two black glass
// lenses (soft glowing eyes inside), two springy antennas, an egg-shaped
// body and a black base. No mouth: it shows feeling with its head, eyes and
// antennas, which keeps it clearly a machine (the PRD's honesty rule) while
// staying warm. Shading, reflections and soft shadows give it a 3D,
// product-photo look.
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
  smile: number; // 0 round glowing pupils … 1 happy arcs
  curve: number; // arc shape: 1 happy, negative = worried
  glow: number; // 0 eyes dark … 1 lit
}

const POSES: Record<Expression, Pose> = {
  idle: { tilt: 0, dip: 0, lookX: 0, lookY: 0, eye: 1, antL: -5, antR: 5, lid: 0, smile: 1, curve: 1, glow: 1 },
  listening: { tilt: -7, dip: -6, lookX: -0.1, lookY: -0.1, eye: 1.06, antL: -1, antR: 1, lid: 0, smile: 0, curve: 1, glow: 1 },
  thinking: { tilt: 8, dip: 0, lookX: 0.65, lookY: -0.6, eye: 0.97, antL: -9, antR: 12, lid: 0.1, smile: 0, curve: 0.4, glow: 0.85 },
  speaking: { tilt: -2, dip: 0, lookX: 0, lookY: 0, eye: 1.02, antL: -4, antR: 4, lid: 0, smile: 1, curve: 1, glow: 1 },
  concerned: { tilt: -5, dip: 10, lookX: 0, lookY: 0.4, eye: 1.04, antL: -26, antR: 26, lid: 0.08, smile: 1, curve: -0.7, glow: 0.9 },
  sleeping: { tilt: 4, dip: 14, lookX: 0, lookY: 0.5, eye: 1, antL: -20, antR: 20, lid: 1, smile: 1, curve: 1, glow: 0 },
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
const EYES = [160, 240];
const EYE_Y = 230;
const LENS_R = 27;

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
    const irises = [0, 1].map((i) => q<SVGGElement>(`.kr__eye--${i} .kr__iris`));
    const arcs = [0, 1].map((i) => q<SVGPathElement>(`.kr__eye--${i} .kr__arc`));
    const pupils = [0, 1].map((i) => q<SVGEllipseElement>(`.kr__eye--${i} .kr__pupil`));
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
        const shut = Math.max(0, Math.min(1, lid));
        // The glowing eye inside the glass: follows the look, squashes on a blink,
        // shows happy arcs or round pupils, and brightens with the voice.
        const open = Math.max(0.05, 1 - shut);
        irises[i].setAttribute(
          "transform",
          `translate(${(cur.lookX * 8).toFixed(2)} ${(cur.lookY * 7).toFixed(2)}) scale(1 ${open.toFixed(3)})`,
        );
        irises[i].setAttribute("opacity", Math.max(0, Math.min(1, cur.glow + voice * 0.15)).toFixed(3));
        const smile = Math.max(0, Math.min(1, cur.smile));
        // mirror the worried slant on each side
        const slant = cur.curve < 0 ? (i ? 1 : -1) * cur.curve * 4 : 0;
        const c = (2 - 15 * cur.curve).toFixed(2);
        arcs[i].setAttribute("d", `M -12.5 ${(4 + slant).toFixed(2)} Q 0 ${c} 12.5 ${(4 - slant).toFixed(2)}`);
        arcs[i].setAttribute("opacity", smile.toFixed(3));
        arcs[i].setAttribute("stroke-width", (5 + voice * 1.5).toFixed(2));
        pupils[i].setAttribute("opacity", (1 - smile).toFixed(3));
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
  const url = (name: string) => `url(#${id(name)})`;
  const glowColour = "#fff3df";
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
        {/* shell: a bright key light from the top left, falling off to the lower right */}
        <radialGradient id={id("shell")} cx="30%" cy="22%" r="95%">
          <stop offset="0%" stopColor={shade(L.shell, 0.85)} />
          <stop offset="45%" stopColor={shade(L.shell, 0.2)} />
          <stop offset="80%" stopColor={shade(L.shell, -0.08)} />
          <stop offset="100%" stopColor={shade(L.shell, -0.2)} />
        </radialGradient>
        <linearGradient id={id("shell-v")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="35%" stopColor="#fff" stopOpacity="0" />
          <stop offset="78%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.16" />
        </linearGradient>
        <radialGradient id={id("body")} cx="32%" cy="22%" r="90%">
          <stop offset="0%" stopColor={shade(L.shell, 0.85)} />
          <stop offset="50%" stopColor={shade(L.shell, 0.12)} />
          <stop offset="85%" stopColor={shade(L.shell, -0.12)} />
          <stop offset="100%" stopColor={shade(L.shell, -0.24)} />
        </radialGradient>
        <linearGradient id={id("body-h")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#000" stopOpacity="0.06" />
          <stop offset="18%" stopColor="#fff" stopOpacity="0.25" />
          <stop offset="45%" stopColor="#fff" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.14" />
        </linearGradient>
        <linearGradient id={id("rim")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={shade(L.eyes, 0.42)} />
          <stop offset="50%" stopColor={shade(L.eyes, 0.05)} />
          <stop offset="100%" stopColor={shade(L.eyes, -0.6)} />
        </linearGradient>
        <radialGradient id={id("lens")} cx="42%" cy="38%" r="70%">
          <stop offset="0%" stopColor={shade(L.eyes, 0.14)} />
          <stop offset="70%" stopColor={L.eyes} />
          <stop offset="100%" stopColor={shade(L.eyes, -0.75)} />
        </radialGradient>
        <radialGradient id={id("base")} cx="40%" cy="30%" r="75%">
          <stop offset="0%" stopColor={shade(L.trim, 0.3)} />
          <stop offset="70%" stopColor={L.trim} />
          <stop offset="100%" stopColor={shade(L.trim, -0.5)} />
        </radialGradient>
        <linearGradient id={id("base-side")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={shade(L.trim, -0.45)} />
          <stop offset="30%" stopColor={shade(L.trim, 0.12)} />
          <stop offset="100%" stopColor={shade(L.trim, -0.55)} />
        </linearGradient>
        <radialGradient id={id("neck")} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor={shade(L.trim, 0.25)} />
          <stop offset="100%" stopColor={shade(L.trim, -0.3)} />
        </radialGradient>
        <filter id={id("soft")} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        <filter id={id("blur4")} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <filter id={id("glow")} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <clipPath id={id("eye-clip")}>
          <circle cx="0" cy="0" r={LENS_R + 4.5} />
        </clipPath>
        <clipPath id={id("glass-clip")}>
          <circle cx="0" cy="0" r={LENS_R - 3} />
        </clipPath>
      </defs>

      {/* soft floor shadow, darker right under the base */}
      <ellipse className="kr__shadow" cx="200" cy="486" rx="108" ry="14" fill="rgba(0,0,0,0.16)" filter={url("soft")} />
      <ellipse cx="200" cy="480" rx="80" ry="7" fill="rgba(0,0,0,0.28)" filter={url("blur4")} />

      <g className="kr__body">
        {/* base: a black puck with a soft sheen on top */}
        <path d="M 124 460 L 124 472 A 76 16 0 0 0 276 472 L 276 460 Z" fill={url("base-side")} />
        <ellipse cx="200" cy="460" rx="76" ry="16" fill={url("base")} />
        <ellipse cx="184" cy="456" rx="40" ry="5" fill="#fff" opacity="0.08" />
        {/* egg body */}
        <path
          d="M 142 300 C 122 330 112 372 116 412 C 119 446 148 462 200 462 C 252 462 281 446 284 412 C 288 372 278 330 258 300 Z"
          fill={url("body")}
        />
        <path
          d="M 142 300 C 122 330 112 372 116 412 C 119 446 148 462 200 462 C 252 462 281 446 284 412 C 288 372 278 330 258 300 Z"
          fill={url("body-h")}
        />
        {/* a long soft highlight down the left side, and a thin rim light */}
        <path d="M 146 330 C 134 360 132 396 140 426" fill="none" stroke="#fff" strokeOpacity="0.75" strokeWidth="10" strokeLinecap="round" filter={url("blur4")} />
        <path d="M 270 318 C 284 350 288 390 280 426" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="2" strokeLinecap="round" />
        {/* the seam where the base would twist */}
        <path d="M 118 418 Q 200 444 282 418" fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth="1.6" />
        {/* the neck opening: a dark recessed collar */}
        <ellipse cx="200" cy="301" rx="60" ry="12" fill={shade(L.shell, -0.18)} />
        <ellipse cx="200" cy="303" rx="52" ry="9" fill={url("neck")} />
        <BodyAccessory kind={L.accessory} accent={L.accent} />
      </g>

      <g className="kr__head">
        {/* contact shadow the head casts onto the body */}
        <ellipse cx="200" cy="310" rx="74" ry="10" fill="rgba(0,0,0,0.18)" filter={url("blur4")} />
        <g transform="translate(0 9)">
          {[0, 1].map((i) => (
            <g key={i} className={`kr__ant kr__ant--${i}`} transform={`translate(${i ? 248 : 152} 172)`}>
              <path d={antenna} fill="none" stroke={L.trim} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="-3.2" y="-152" width="6.4" height="18" rx="3.2" fill={L.trim} />
              <circle cx="-1" cy="-148" r="1.4" fill="#fff" opacity="0.5" />
            </g>
          ))}
          {/* head: rounded box with layered light */}
          <rect x="106" y="166" width="188" height="130" rx="40" fill={url("shell")} />
          <rect x="106" y="166" width="188" height="130" rx="40" fill={url("shell-v")} />
          <rect x="107" y="167" width="186" height="128" rx="39" fill="none" stroke="#fff" strokeOpacity="0.6" strokeWidth="1.5" />
          {/* broad soft specular highlight on the top */}
          <ellipse cx="170" cy="184" rx="50" ry="9" fill="#fff" opacity="0.75" filter={url("blur4")} />
          {/* the right side turning away from the light */}
          <path d="M 268 170 Q 294 174 294 206 L 294 258 Q 294 292 262 295 Q 286 268 286 230 Q 286 190 268 170 Z" fill="rgba(0,0,0,0.07)" />
          <HeadAccessory kind={L.accessory} accent={L.accent} shell={L.shell} />
          <g className="kr__eyes">
            {/* the bridge joining the lenses, like glasses */}
            <rect x="184" y="225" width="32" height="8" rx="4" fill={url("rim")} />
            {[0, 1].map((i) => (
              <g key={i} className={`kr__eye kr__eye--${i}`}>
                <g className="kr__lens" transform={`translate(${EYES[i]} ${EYE_Y})`}>
                  {/* soft shadow the lens drops onto the face */}
                  <circle cy="3" r={LENS_R + 5} fill="rgba(0,0,0,0.18)" filter={url("blur4")} />
                  {/* metal rim and black glass */}
                  <circle r={LENS_R + 4} fill={url("rim")} />
                  <circle r={LENS_R - 1} fill={shade(L.eyes, -0.5)} />
                  <circle r={LENS_R - 3} fill={url("lens")} />
                  {/* the glowing eye behind the glass */}
                  <g clipPath={url("glass-clip")}>
                    <g className="kr__iris" filter={url("glow")}>
                      <path className="kr__arc" d="M -12.5 4 Q 0 -13 12.5 4" fill="none" stroke={glowColour} strokeWidth="5" strokeLinecap="round" />
                      <ellipse className="kr__pupil" rx="7" ry="8.5" fill={glowColour} opacity="0" />
                    </g>
                  </g>
                  {/* reflections on the glass stay put while the eye moves */}
                  <g className="kr__glint">
                    <path d={`M ${-LENS_R + 7} -6 A ${LENS_R - 7} ${LENS_R - 7} 0 0 1 -4 ${-LENS_R + 7}`} fill="none" stroke="#fff" strokeOpacity="0.32" strokeWidth="3" strokeLinecap="round" />
                    <circle cx="-12" cy="-14" r="2.2" fill="#fff" opacity="0.8" />
                    <path d={`M 8 ${LENS_R - 9} A ${LENS_R - 9} ${LENS_R - 9} 0 0 0 ${LENS_R - 9} 8`} fill="none" stroke="#fff" strokeOpacity="0.14" strokeWidth="2.5" strokeLinecap="round" />
                  </g>
                  {/* a dark shutter slides down over the glass */}
                  <g clipPath={url("eye-clip")}>
                    <rect className="kr__lid" x={-LENS_R - 6} y={-LENS_R - 6} width={LENS_R * 2 + 12} height="0" fill={shade(L.eyes, 0.08)} />
                  </g>
                  {/* the closed eye: a soft downward curve */}
                  <path className="kr__closed" d={`M -12 0 Q 0 9 12 0`} fill="none" stroke="#b9ab96" strokeWidth="3.5" strokeLinecap="round" opacity="0" />
                </g>
              </g>
            ))}
          </g>
        </g>
      </g>
    </svg>
  );
}
