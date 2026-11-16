// Kinly's look: colours and accessories ("swag").
//
// DEFAULT_LOOK is what every household starts with. Families can change it
// on the dashboard (Kinly's look), which saves a copy in the household; to
// change the default for everyone, edit DEFAULT_LOOK here. Add new colour
// sets to PRESETS and new accessories to ACCESSORIES (then draw them in
// src/elder/KinlyRobot.tsx, see <Accessory/>).

export type Accessory = "none" | "bowtie" | "kente" | "headphones" | "kufi" | "flower" | "beads";

export interface RobotLook {
  /** Head and body shell. */
  shell: string;
  /** Lens eyes and the bridge between them. */
  eyes: string;
  /** Antennas and the base. */
  trim: string;
  accessory: Accessory;
  /** Main colour of the accessory (bow tie, cap, headphones, flower, beads). */
  accent: string;
}

export const DEFAULT_LOOK: RobotLook = {
  shell: "#f4f4f2",
  eyes: "#121214",
  trim: "#1c1c1c",
  accessory: "none",
  accent: "#e8690f",
};

export const PRESETS: { name: string; look: Partial<RobotLook> }[] = [
  { name: "Classic", look: { shell: "#f4f4f2", eyes: "#121214", trim: "#1c1c1c" } },
  { name: "Sunset", look: { shell: "#f7c9a0", eyes: "#3a1a0c", trim: "#7a3410" } },
  { name: "Kente gold", look: { shell: "#f3d27a", eyes: "#1d1a10", trim: "#2f6b3a" } },
  { name: "Ocean", look: { shell: "#bfe0ee", eyes: "#0f2430", trim: "#1e4f6b" } },
  { name: "Leaf", look: { shell: "#cfe8c4", eyes: "#14240f", trim: "#2f5a26" } },
  { name: "Rose", look: { shell: "#f6cfd6", eyes: "#2a1016", trim: "#7a2d3d" } },
  { name: "Midnight", look: { shell: "#3a3d46", eyes: "#0b0b0d", trim: "#111214" } },
];

export const ACCESSORIES: { id: Accessory; label: string }[] = [
  { id: "none", label: "None" },
  { id: "bowtie", label: "Bow tie" },
  { id: "kente", label: "Kente scarf" },
  { id: "headphones", label: "Headphones" },
  { id: "kufi", label: "Kufi cap" },
  { id: "flower", label: "Flower" },
  { id: "beads", label: "Beads" },
];

/** The household's look, filled in from the defaults (and safe against bad saved values). */
export function resolveLook(saved?: Partial<RobotLook>): RobotLook {
  const hex = (v: unknown, fallback: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback);
  const accessory = ACCESSORIES.some((a) => a.id === saved?.accessory) ? (saved!.accessory as Accessory) : DEFAULT_LOOK.accessory;
  return {
    shell: hex(saved?.shell, DEFAULT_LOOK.shell),
    eyes: hex(saved?.eyes, DEFAULT_LOOK.eyes),
    trim: hex(saved?.trim, DEFAULT_LOOK.trim),
    accent: hex(saved?.accent, DEFAULT_LOOK.accent),
    accessory,
  };
}

/** Mix a colour towards white (amount > 0) or black (amount < 0). */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((c) =>
    Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount)),
  );
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
