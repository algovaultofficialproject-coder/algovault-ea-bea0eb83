import { describe, expect, it, vi } from "vitest";
import { profileShapeForInterface, shapesForInterface, tradingPrefs } from "./trading-prefs";

describe("Crimson profile shape", () => {
  it("always uses the normal shape without losing other interfaces' saved shapes", () => {
    for (const shape of ["classic", "halo", "widescreen"] as const) {
      expect(profileShapeForInterface("m7", shape)).toBe("classic");
    }
  });
});

describe("Extra interfaces shape", () => {
  it("never uses The Halo on the new designs but keeps widescreen", () => {
    for (const id of ["m10", "m13"]) {
      expect(profileShapeForInterface(id, "halo")).toBe("classic");
      expect(profileShapeForInterface(id, "widescreen")).toBe("widescreen");
    }
  });

  it("gives the screenshot-copied designs only the classic and widescreen shapes", () => {
    for (const id of ["m2", "m4", "m6", "m8", "m9", "m16"]) {
      expect(shapesForInterface(id)).toEqual(["classic", "widescreen"]);
      expect(profileShapeForInterface(id, "halo")).toBe("classic");
      expect(profileShapeForInterface(id, "widescreen")).toBe("widescreen");
    }
  });

  it("locks Cipher to the normal shape and lets Hologram keep widescreen", () => {
    for (const shape of ["classic", "halo", "widescreen"] as const) {
      expect(profileShapeForInterface("m14", shape)).toBe("classic");
    }
    expect(shapesForInterface("m14")).toEqual(["classic"]);
    expect(profileShapeForInterface("m15", "widescreen")).toBe("widescreen");
    expect(profileShapeForInterface("m15", "halo")).toBe("classic");
  });
});

describe("Bot background image", () => {
  it("keeps the image on by default and saves both blank and visible choices", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    try {
      expect(tradingPrefs.get().botImage).toBe(true);
      tradingPrefs.setBotImage(false);
      expect(tradingPrefs.get().botImage).toBe(false);
      expect(JSON.parse(storage.get("algo:trading-prefs") ?? "{}").botImage).toBe(false);
      tradingPrefs.setBotImage(true);
      expect(tradingPrefs.get().botImage).toBe(true);
      expect(JSON.parse(storage.get("algo:trading-prefs") ?? "{}").botImage).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});