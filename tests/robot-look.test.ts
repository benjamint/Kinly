import { describe, expect, it } from "vitest";
import { ACCESSORIES, DEFAULT_LOOK, PRESETS, resolveLook, shade } from "../src/shared/robotLook";

describe("Kinly's look", () => {
  it("falls back to the defaults for anything not set or not valid", () => {
    expect(resolveLook(undefined)).toEqual(DEFAULT_LOOK);
    const look = resolveLook({ shell: "#123456", eyes: "red", accessory: "jetpack" as never });
    expect(look.shell).toBe("#123456");
    expect(look.eyes).toBe(DEFAULT_LOOK.eyes); // not a #rrggbb colour
    expect(look.accessory).toBe("none"); // unknown accessory
  });

  it("keeps a chosen accessory", () => {
    for (const a of ACCESSORIES) expect(resolveLook({ accessory: a.id }).accessory).toBe(a.id);
  });

  it("shades colours towards white and black", () => {
    expect(shade("#808080", 1)).toBe("#ffffff");
    expect(shade("#808080", -1)).toBe("#000000");
    expect(shade("#808080", 0)).toBe("#808080");
  });

  it("presets use valid colours", () => {
    for (const p of PRESETS) expect(resolveLook(p.look)).toMatchObject(p.look);
  });
});
