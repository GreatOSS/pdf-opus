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
  it("skips rotated text and ignores empty queries", () => {
    expect(matchRects([item("secret", 0, 0, 10, true)], "secret")).toEqual({ rects: [], skipped: 1 });
    expect(matchRects([item("secret")], "  ").rects).toHaveLength(0);
  });
});
