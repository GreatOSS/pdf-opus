import { describe, expect, it } from "vitest";
import { matchRects } from "../src/findmarks";

describe("matchRects", () => {
  const item = (str: string, x = 100, y = 500, size = 10, rotated = false) => ({ str, width: str.length * 5, transform: rotated ? [0, size, -size, 0, x, y] : [size, 0, 0, size, x, y] });
  it("finds every case-insensitive match with padded extents", () => {
    const { rects } = matchRects([item("SSN 123-45-6789 and ssn again")], "ssn");
    expect(rects).toHaveLength(2);
    const [x, y, w, h] = rects[0];
    expect(x).toBeCloseTo(100 - 2);
    expect(w).toBeCloseTo(15 + 4);
    expect(y).toBeCloseTo(497.5);
    expect(h).toBeCloseTo(12);
    expect(rects[1][0]).toBeCloseTo(100 + 20 * 5 - 2);
  });
  it("matches rotated text in its reading direction, skips mirrored text, ignores empty queries", () => {
    // Text running up the page (a sidebar): glyphs extend towards -x from the baseline.
    const r = matchRects([item("secret", 0, 0, 10, true)], "secret");
    expect(r.matches).toBe(1);
    [-9.5, -2, 12, 34].forEach((v, k) => expect(r.rects[0][k]).toBeCloseTo(v));
    // Upside down (180°) and a phrase split across two rotated items.
    expect(matchRects([{ str: "top secret", width: 50, transform: [-10, 0, 0, -10, 300, 700] }], "secret").rects[0][0]).toBeCloseTo(300 - 50 - 2);
    expect(matchRects([item("John", 50, 100, 10, true), item("Smith", 50, 130, 10, true)], "john smith").matches).toBe(1);
    expect(matchRects([{ str: "secret", width: 30, transform: [-10, 0, 0, 10, 0, 0] }], "secret")).toEqual({ rects: [], skipped: 1, matches: 0 });
    expect(matchRects([item("secret")], "  ").rects).toHaveLength(0);
  });
  it("finds phrases split across items on the same line, but not across lines", () => {
    // "John" + "Smith" as separate items with a word gap; "Sm" + "ith" kerned apart without a gap.
    const items = [item("Name: John", 100), item("Smith", 160), item("Sm", 100, 400), item("ith", 110, 400), item("John", 100, 300), item("Smith", 100, 280)];
    const { rects } = matchRects(items, "john  smith");
    expect(rects).toHaveLength(2);
    expect(matchRects(items, "john smith").matches).toBe(1); // one match, one rect per piece
    expect(rects[0][0]).toBeCloseTo(100 + 6 * 5 - 2);
    expect(rects[0][2]).toBeCloseTo(20 + 4);
    expect(rects[1][0]).toBeCloseTo(160 - 2);
    expect(matchRects(items, "smith").rects).toHaveLength(4); // the split one gives a rect per piece
    expect(matchRects(items, "smith").rects.filter((r) => r[1] < 450 && r[1] > 350)).toHaveLength(2);
  });
});
