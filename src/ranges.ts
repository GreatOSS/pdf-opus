// Page-range parsing shared by dialogs (kept separate so it loads without pdf-lib).
/** Parse a human page-range string like "1-3, 5, 8-" into zero-based indices. */
export function parsePageRanges(input: string, pageCount: number): number[] {
  const out: number[] = [];
  const text = input.trim();
  if (!text) throw new Error("Enter pages, e.g. 1-3, 5");
  for (const part of text.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d*)\s*[-–]\s*(\d*)$/.exec(part) ?? /^(\d+)()$/.exec(part);
    if (!m) throw new Error(`“${part}” is not a page or range.`);
    const single = !part.match(/[-–]/);
    const a = m[1] ? parseInt(m[1], 10) : 1;
    const b = single ? a : m[2] ? parseInt(m[2], 10) : pageCount;
    if (a < 1 || b < 1 || a > pageCount || b > pageCount) {
      throw new Error(`Pages must be between 1 and ${pageCount}.`);
    }
    const step = a <= b ? 1 : -1;
    for (let p = a; p !== b + step; p += step) out.push(p - 1);
  }
  return out;
}

export interface SplitPart { pages: number[]; label: string } // zero-based pages; label for the file name

const span = (a: number, b: number) => (a === b ? `${a + 1}` : `${a + 1}-${b + 1}`);

/** Split into files of `size` pages each (the last one may be shorter). */
export function splitEvery(pageCount: number, size: number): SplitPart[] {
  const out: SplitPart[] = [];
  for (let a = 0; a < pageCount; a += size) {
    const b = Math.min(a + size, pageCount) - 1;
    out.push({ pages: Array.from({ length: b - a + 1 }, (_, i) => a + i), label: `pages ${span(a, b)}` });
  }
  return out;
}

/** One file per section, each starting at a (top-level) bookmark; pages before the first bookmark get their own file. */
export function splitAtStarts(pageCount: number, starts: { page: number; title: string }[]): SplitPart[] {
  // Sorted by page; when several bookmarks start on the same page, the first one names the file.
  const s = starts.filter((x) => x.page >= 0 && x.page < pageCount).sort((x, y) => x.page - y.page)
    .filter((x, i, all) => i === 0 || all[i - 1].page !== x.page);
  if (!s.length) return [];
  if (s[0].page > 0) s.unshift({ page: 0, title: "" });
  return s.map((x, i) => {
    const end = (s[i + 1]?.page ?? pageCount) - 1;
    return { pages: Array.from({ length: end - x.page + 1 }, (_, k) => x.page + k), label: x.title || `pages ${span(x.page, end)}` };
  });
}

/** “1-3, 4-7, 8-” → one file per comma-separated range. */
export function splitCustom(input: string, pageCount: number): SplitPart[] {
  const parts = input.split(/[,;]/).map((t) => t.trim()).filter(Boolean);
  if (!parts.length) throw new Error("Enter page ranges, e.g. 1-3, 4-7, 8-");
  return parts.map((t) => ({ pages: parsePageRanges(t.replace(/\s+/g, ""), pageCount), label: `pages ${t.replace(/\s+/g, "")}` }));
}

/** A safe, readable file-name fragment. */
export const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "part";
