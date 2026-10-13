let ctx: AudioContext | null = null;

/** A soft two-note chime so Kinly never starts talking out of nowhere. */
export function chime() {
  try {
    ctx ??= new AudioContext();
    const now = ctx.currentTime;
    [659.25, 880].forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = now + i * 0.28;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.25, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(t);
      osc.stop(t + 1);
    });
  } catch {
    /* audio unavailable */
  }
}

const DRUM_NOTES = [196, 247, 294, 392];

/** A short, warm drum-like tone for drum memory (0–3). */
export function drum(i: number) {
  try {
    ctx ??= new AudioContext();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(DRUM_NOTES[i % DRUM_NOTES.length] * 1.5, now);
    osc.frequency.exponentialRampToValueAtTime(DRUM_NOTES[i % DRUM_NOTES.length], now + 0.08);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.5, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.65);
  } catch {
    /* audio unavailable */
  }
}

let wakeLock: { released: boolean } | null = null;

/** Keep the screen on and go full screen, so the face is always there. */
export async function stayAwake() {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<typeof wakeLock> } };
    // The OS releases the lock when the app is hidden, so re-take it on each tap.
    if ((!wakeLock || wakeLock.released) && nav.wakeLock) wakeLock = await nav.wakeLock.request("screen");
  } catch {
    /* not supported or not allowed */
  }
  try {
    const standalone = matchMedia("(display-mode: fullscreen), (display-mode: standalone)").matches;
    if (!standalone && !document.fullscreenElement) await document.documentElement.requestFullscreen?.();
  } catch {
    /* needs a user gesture; fine to skip */
  }
}
