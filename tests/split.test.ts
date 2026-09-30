import { describe, it, expect } from "vitest";
import { splitEvery, splitAtStarts, splitCustom, fileSafe } from "../src/ranges";

describe("split planning", () => {
  it("every N pages", () => {
    expect(splitEvery(7, 3).map((p) => [p.pages, p.label])).toEqual([[[0, 1, 2], "pages 1-3"], [[3, 4, 5], "pages 4-6"], [[6], "pages 7"]]);
  });
  it("at bookmarks, with front matter and duplicates", () => {
    const r = splitAtStarts(10, [{ page: 5, title: "Two" }, { page: 2, title: "One" }, { page: 5, title: "Dup" }]);
    expect(r.map((p) => [p.pages[0], p.pages.at(-1), p.label])).toEqual([[0, 1, "pages 1-2"], [2, 4, "One"], [5, 9, "Two"]]);
    expect(splitAtStarts(3, [])).toEqual([]);
  });
  it("custom ranges", () => {
    expect(splitCustom("1-2, 5 ; 7-", 8).map((p) => p.pages)).toEqual([[0, 1], [4], [6, 7]]);
    expect(() => splitCustom("1-20", 8)).toThrow();
  });
  it("file-safe names", () => {
    expect(fileSafe('A/B: "C"?')).toBe("A B C");
  });
});
