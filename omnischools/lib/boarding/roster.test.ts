import { describe, it, expect } from "vitest";
import {
  assembleDorms,
  bunkState,
  buildPrefectStrip,
  isLightColour,
  summarize,
  type RawBunk,
  type RawDorm,
  type RosterOccupant,
} from "./roster";

describe("isLightColour — the white-House border guard", () => {
  it("flags near-white / bright colours (dark text + border)", () => {
    expect(isLightColour("#FFFFFF")).toBe(true); // Slessor
    expect(isLightColour("#E5C44A")).toBe(true); // Kingsley yellow
  });
  it("leaves dark/brand-collision colours as cream-text (no border)", () => {
    expect(isLightColour("#1A2B47")).toBe(false); // Guggisberg == brand navy
    expect(isLightColour("#B43A2F")).toBe(false); // Aggrey red
    expect(isLightColour(null)).toBe(false);
    expect(isLightColour("nonsense")).toBe(false);
  });
});

const occ = (over: Partial<RosterOccupant> = {}): RosterOccupant => ({
  studentId: "s1",
  studentCode: "C1",
  name: "J. Manu",
  fullName: "Joseph Manu",
  sex: "MALE",
  formLabel: "Form 2 GA",
  flagged: false,
  movedThisSem: false,
  allocatedAtLabel: null,
  allocationReason: null,
  ...over,
});

describe("bunkState precedence (flagged > prefect > moved > occupied > vacant)", () => {
  it("empty bunk is vacant", () => {
    expect(bunkState(null, null)).toBe("vacant");
    expect(bunkState("HEAD", null)).toBe("vacant"); // tagged but unoccupied still vacant
  });
  it("a flagged occupant wins even on a prefect bunk", () => {
    expect(bunkState("HEAD", occ({ flagged: true }))).toBe("flagged");
    expect(bunkState("HEAD", occ({ flagged: true, movedThisSem: true }))).toBe("flagged");
  });
  it("a prefect bunk beats a same-semester move", () => {
    expect(bunkState("DINING", occ({ movedThisSem: true }))).toBe("prefect");
  });
  it("moved-this-sem shows over a plain occupied", () => {
    expect(bunkState(null, occ({ movedThisSem: true }))).toBe("moved");
  });
  it("a plain occupant is occupied", () => {
    expect(bunkState(null, occ())).toBe("occupied");
  });
});

describe("assembleDorms — data-driven N×M, ordered (AC A5/B1/J5)", () => {
  // A deliberately-irregular House: 2 dorms, one with 3 bunks, one with 2 (NOT 8×15).
  const dorms: RawDorm[] = [
    { id: "dB", name: "B", sectionLabel: null },
    { id: "dA", name: "A", sectionLabel: "senior" },
  ];
  const bunks: RawBunk[] = [
    { id: "a3", dormId: "dA", position: 3, prefectRole: null },
    { id: "a1", dormId: "dA", position: 1, prefectRole: "HEAD" },
    { id: "a2", dormId: "dA", position: 2, prefectRole: null },
    { id: "b2", dormId: "dB", position: 2, prefectRole: null },
    { id: "b1", dormId: "dB", position: 1, prefectRole: null },
  ];
  const occupants = new Map<string, RosterOccupant>([
    ["a1", occ({ studentId: "head" })],
    ["a3", occ({ studentId: "flag", flagged: true })],
    ["b1", occ({ studentId: "mv", movedThisSem: true })],
  ]);
  const result = assembleDorms(dorms, bunks, occupants);

  it("renders the actual dorm/bunk counts, not 8×15", () => {
    expect(result.map((d) => d.name)).toEqual(["A", "B"]); // sorted A→B
    expect(result[0].bunks.length).toBe(3);
    expect(result[1].bunks.length).toBe(2);
  });
  it("orders bunks by position and zero-pads the address", () => {
    expect(result[0].bunks.map((b) => b.position)).toEqual([1, 2, 3]);
    expect(result[0].bunks[0].addressShort).toBe("A-01");
    expect(result[0].bunks[2].address).toBe("Dorm A bunk 03");
  });
  it("assigns each state from data", () => {
    const [b1, b2, b3] = result[0].bunks;
    expect(b1.state).toBe("prefect"); // A-01 HEAD, occupied
    expect(b2.state).toBe("vacant"); // A-02 empty
    expect(b3.state).toBe("flagged"); // A-03 flagged occupant
    expect(result[1].bunks[0].state).toBe("moved"); // B-01 moved-this-sem
  });
  it("counts filled per dorm", () => {
    expect(result[0].filled).toBe(2);
    expect(result[1].filled).toBe(1);
  });

  it("buildPrefectStrip returns 5 ordered slots; empty roles carry a null occupant (B5)", () => {
    const strip = buildPrefectStrip(result);
    expect(strip.map((s) => s.role)).toEqual([
      "HEAD",
      "DINING",
      "SANITATION",
      "PREP",
      "SICKBAY",
    ]);
    expect(strip[0].occupant?.studentId).toBe("head");
    expect(strip[0].addressShort).toBe("A-01");
    expect(strip[1].occupant).toBeNull(); // DINING not tagged → empty slot
  });

  it("summarize derives totals (vacant = total − filled) and unallocated tray count", () => {
    const s = summarize(result, /*boarderCount*/ 4, /*unallocatedCount*/ 1);
    expect(s.totalBunks).toBe(5);
    expect(s.filled).toBe(3);
    expect(s.vacant).toBe(2);
    expect(s.boarderCount).toBe(4);
    expect(s.unallocatedCount).toBe(1);
    expect(s.prefectCount).toBe(1);
    expect(s.flaggedCount).toBe(1);
    expect(s.movedThisSemCount).toBe(1);
  });
});
