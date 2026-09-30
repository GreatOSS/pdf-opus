import { describe, expect, it } from "vitest";
import { fontStyle, groupRuns, isJustified, joinLines, looksCentered, paragraphOf, unsupportedChars } from "../src/edittext";

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

describe("paragraphOf", () => {
  const run = (str: string, x: number, y: number, width: number, size = 10, fontName = "f1") => ({ str, x, y, width, size, fontName });
  // Indented first line, full lines, short last line; then a new paragraph; a second column alongside.
  const lines = [
    run("First line of a paragraph", 70, 700, 230), run("continues on the next line", 54, 688, 246), run("and ends here.", 54, 676, 120),
    run("Next paragraph starts", 70, 664, 230), run("and goes on.", 54, 652, 100),
    run("Right column text", 320, 700, 240), run("more right column", 320, 688, 240),
  ];
  it("finds the paragraph around a clicked line", () => {
    expect(paragraphOf(lines[1], lines).map((u) => u.str)).toEqual(["First line of a paragraph", "continues on the next line", "and ends here."]);
    expect(paragraphOf(lines[4], lines).map((u) => u.str)).toEqual(["Next paragraph starts", "and goes on."]);
    expect(paragraphOf(lines[5], lines).map((u) => u.str)).toEqual(["Right column text", "more right column"]);
  });
  it("stays on one line for mixed fonts, other sizes and uneven spacing", () => {
    const bold = [run("A heading", 54, 720, 90, 10, "bold"), run("Body line with", 54, 700, 100), run("bold", 157, 700, 20, 10, "bold"), run("word", 180, 700, 30)];
    expect(paragraphOf(bold[1], bold)).toHaveLength(1);
    const sizes = [run("Big", 54, 720, 90, 14), run("small", 54, 706, 90)];
    expect(paragraphOf(sizes[1], sizes)).toHaveLength(1);
    const uneven = [run("one", 54, 700, 200), run("two", 54, 688, 200), run("far", 54, 672, 200)];
    expect(paragraphOf(uneven[0], uneven).map((u) => u.str)).toEqual(["one", "two"]);
  });
  it("handles ragged text, list items and indents like the IRS W-9 instructions", () => {
    // Ragged right: line 2 is much shorter than line 1, but the next word wouldn't have fitted on it.
    const w9 = [
      run("must obtain your correct taxpayer identification number (TIN), which", 36, 700, 270, 9),
      run("may be your social security number (SSN), individual taxpayer", 36, 689, 240, 9),
      run("identification number (ITIN), adoption taxpayer identification number", 36, 678, 268, 9),
      run("are not limited to, the following.", 36, 667, 130, 9),
      run("• Form 1099-DIV (dividends, including those from stocks or mutual", 36, 654, 262, 9),
      run("funds).", 36, 643, 28, 9),
      run("• Form 1099-K (merchant card and third-party network transactions).", 36, 630, 268, 9),
      run("• Form 1098 (home mortgage interest), 1098-E (student loan interest),", 36, 617, 266, 9),
      run("and 1098-T (tuition).", 36, 606, 80, 9),
      run("Use Form W-9 only if you are a U.S. person (including a resident", 44, 593, 255, 9),
      run("alien), to provide your correct TIN.", 36, 582, 140, 9),
    ];
    const p = (i: number) => paragraphOf(w9[i], w9).map((u) => w9.indexOf(u));
    expect(p(1)).toEqual([0, 1, 2, 3]);
    expect(p(4)).toEqual([4, 5]);
    expect(p(5)).toEqual([4, 5]);
    expect(p(6)).toEqual([6]);
    expect(p(7)).toEqual([7, 8]);
    expect(p(9)).toEqual([9, 10]);
  });
  it("joins lines, rejoining hyphenated words", () => {
    expect(joinLines(["more difficult to com-", "pile than ", " others"])).toBe("more difficult to compile than others");
    expect(joinLines(["the Java-", "Script engine"])).toBe("the Java-Script engine");
  });
});

describe("isJustified", () => {
  const l = (x: number, width: number) => ({ x, width, size: 10 });
  it("tells justified from ragged paragraphs", () => {
    expect(isJustified([l(54, 243), l(54, 243.4), l(54, 242.8), l(54, 120)])).toBe(true);
    expect(isJustified([l(54, 243), l(54, 225), l(54, 238), l(54, 120)])).toBe(false);
    expect(isJustified([l(54, 243), l(54, 100)])).toBe(false); // too short to tell
  });
});
