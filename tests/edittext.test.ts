import { describe, expect, it } from "vitest";
import { groupRuns, unsupportedChars } from "../src/edittext";

const item = (str: string, x: number, y: number, width: number, size = 10, fontName = "f1") => ({ str, transform: [size, 0, 0, size, x, y], width, fontName });

describe("groupRuns", () => {
  it("joins adjacent items on one baseline and inserts spaces for gaps", () => {
    const runs = groupRuns([item("Hello", 10, 100, 25), item("world", 38, 100, 25), item("Next", 10, 80, 20)]);
    expect(runs.map((r) => r.str)).toEqual(["Hello world", "Next"]);
    expect(runs[0].width).toBe(53);
  });
  it("keeps different fonts, sizes and distant items apart and skips rotated text", () => {
    const runs = groupRuns([item("A", 10, 100, 5), item("B", 16, 100, 5, 10, "f2"), item("C", 200, 100, 5), { str: "R", transform: [0, 10, -10, 0, 5, 5], width: 5, fontName: "f1" }]);
    expect(runs.map((r) => r.str)).toEqual(["A", "B", "C"]);
  });
});

describe("unsupportedChars", () => {
  it("accepts WinAnsi text and flags the rest", () => {
    expect(unsupportedChars("Café – “ok” €5")).toEqual([]);
    expect(unsupportedChars("Łódź 日本")).toEqual(["Ł", "ź", "日", "本"]);
  });
});
