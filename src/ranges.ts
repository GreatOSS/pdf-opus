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
