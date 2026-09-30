import { describe, expect, it } from "vitest";
import { fontStyle, groupRuns, looksCentered, unsupportedChars } from "../src/edittext";

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

describe("looksCentered", () => {
  const view = [0, 0, 612, 792];
  // Two-column paper body: left column 54–297, right column 315–558.
  const body = Array.from({ length: 40 }, (_, i) => (i % 2 ? { x: 315, width: 243 } : { x: 54, width: 243 }));
  it("detects long and short centred titles", () => {
    expect(looksCentered({ x: 80.5, width: 449.1 }, body, view)).toBe(true); // tracemonkey title
    expect(looksCentered({ x: 263.7, width: 82.7 }, body, view)).toBe(true); // "Languages"
  });
  it("rejects column text, indents and flush-left lines", () => {
    expect(looksCentered({ x: 54, width: 243 }, body, view)).toBe(false);
    expect(looksCentered({ x: 315, width: 243 }, body, view)).toBe(false);
    expect(looksCentered({ x: 315, width: 120 }, body, view)).toBe(false);
    const single = Array.from({ length: 40 }, () => ({ x: 72, width: 468 }));
    expect(looksCentered({ x: 92, width: 448 }, single, view)).toBe(false); // first-line indent of 20pt
    expect(looksCentered({ x: 72, width: 200 }, single, view)).toBe(false);
  });
});

describe("fontStyle", () => {
  it("recognises bold and italic from common font names", () => {
    expect(fontStyle("TACTGM+NimbusRomNo9L-Medi")).toEqual({ bold: true, italic: false });
    expect(fontStyle("NimbusRomNo9L-MediItal")).toEqual({ bold: true, italic: true });
    expect(fontStyle("NimbusRomNo9L-ReguItal")).toEqual({ bold: false, italic: true });
    expect(fontStyle("CMBX10")).toEqual({ bold: true, italic: false });
    expect(fontStyle("CMTI10").italic).toBe(true);
    expect(fontStyle("Arial,Bold").bold).toBe(true);
    expect(fontStyle("Roboto-Medium").bold).toBe(false);
    expect(fontStyle("NimbusRomNo9L-Regu")).toEqual({ bold: false, italic: false });
    expect(fontStyle("Whatever", { bold: true }).bold).toBe(true);
  });
});
