import { useEffect, useRef, useState } from "react";

export type Expression = "idle" | "listening" | "thinking" | "speaking" | "concerned" | "sleeping";

interface FaceProps {
  expression: Expression;
  /** 0–1 voice loudness, polled every frame to move the mouth. */
  getVolume: () => number;
}

// Geometry in a 400×440 box; the SVG scales to fill whatever screen it gets.
const MOUTH_Y = 318;
const MOUTH_HALF = 58;

function mouthPath(open: number, smile: number): string {
  const l = 200 - MOUTH_HALF;
  const r = 200 + MOUTH_HALF;
  const top = MOUTH_Y + smile * 6 - open * 8;
  const bottom = MOUTH_Y + smile * 26 + open * 54;
  return `M ${l} ${MOUTH_Y} Q 200 ${top} ${r} ${MOUTH_Y} Q 200 ${bottom} ${l} ${MOUTH_Y} Z`;
}

/**
 * Kinly's face. Deliberately simple and soft: big kind eyes, rosy cheeks, a
 * mouth that moves with the voice. Everything reads at arm's length.
 */
export function Face({ expression, getVolume }: FaceProps) {
  const mouth = useRef<SVGPathElement>(null);
  const [blink, setBlink] = useState(false);
  const [glance, setGlance] = useState({ x: 0, y: 0 });

  // Mouth follows the voice, smoothed so it doesn't jitter.
  useEffect(() => {
    let raf = 0;
    let level = 0;
    const smile = expression === "concerned" ? -0.6 : expression === "sleeping" ? 0.1 : 1;
    const tick = () => {
      const target = expression === "speaking" ? Math.min(1, getVolume() * 1.6) : 0;
      level += (target - level) * (target > level ? 0.5 : 0.25);
      mouth.current?.setAttribute("d", mouthPath(level, smile));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [expression, getVolume]);

  // Natural blinking at irregular intervals.
  useEffect(() => {
    if (expression === "sleeping") return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setBlink(true);
        timer = setTimeout(() => {
          setBlink(false);
          schedule();
        }, 140);
      }, 2200 + Math.random() * 3800);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [expression]);

  // When idle, Kinly glances around now and then, like someone keeping you company.
  useEffect(() => {
    if (expression !== "idle") {
      setGlance(expression === "thinking" ? { x: 10, y: -12 } : { x: 0, y: 0 });
      return;
    }
    const timer = setInterval(() => {
      const r = Math.random();
      setGlance(r < 0.5 ? { x: 0, y: 0 } : { x: (Math.random() - 0.5) * 24, y: (Math.random() - 0.5) * 10 });
    }, 3500);
    return () => clearInterval(timer);
  }, [expression]);

  const eyeScale = expression === "listening" ? 1.12 : expression === "concerned" ? 0.95 : 1;
  const sleeping = expression === "sleeping";

  return (
    <svg
      className={`face face--${expression}`}
      viewBox="0 0 400 440"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Kinly is ${expression === "idle" ? "here" : expression}`}
    >
      <g className="face__breath">
        {/* cheeks */}
        <ellipse className="face__cheek" cx="92" cy="268" rx="40" ry="24" />
        <ellipse className="face__cheek" cx="308" cy="268" rx="40" ry="24" />

        {/* brows only show feeling: worried tilt when concerned, raised when listening */}
        <g className="face__brows" opacity={expression === "concerned" || expression === "listening" ? 1 : 0}>
          <path
            d={expression === "concerned" ? "M 96 128 Q 126 110 160 124" : "M 98 112 Q 128 96 160 110"}
            className="face__brow"
          />
          <path
            d={expression === "concerned" ? "M 240 124 Q 274 110 304 128" : "M 240 110 Q 272 96 302 112"}
            className="face__brow"
          />
        </g>

        {sleeping ? (
          <g className="face__sleep-eyes">
            <path d="M 98 196 Q 128 216 160 196" className="face__lid" />
            <path d="M 240 196 Q 272 216 302 196" className="face__lid" />
          </g>
        ) : (
          <g
            className={`face__eyes${blink ? " face__eyes--blink" : ""}`}
            style={{ transform: `translate(${glance.x}px, ${glance.y}px)` }}
          >
            {[128, 272].map((cx) => (
              <g key={cx} className="face__eye" style={{ transform: `scale(${eyeScale})` }}>
                <ellipse cx={cx} cy="194" rx="36" ry="46" className="face__iris" />
                <circle cx={cx + 12} cy="176" r="12" className="face__shine" />
                <circle cx={cx - 10} cy="210" r="5" className="face__shine face__shine--small" />
              </g>
            ))}
          </g>
        )}

        <path ref={mouth} className="face__mouth" d={mouthPath(0, 1)} />

        {expression === "thinking" && (
          <g className="face__dots">
            <circle cx="170" cy="400" r="9" />
            <circle cx="200" cy="400" r="9" />
            <circle cx="230" cy="400" r="9" />
          </g>
        )}
        {sleeping && (
          <g className="face__zzz" aria-hidden="true">
            <text x="318" y="120">z</text>
            <text x="342" y="88">z</text>
          </g>
        )}
      </g>
    </svg>
  );
}
