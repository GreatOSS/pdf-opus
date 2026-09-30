// Accessible names for form fields that have no tooltip (/TU): guess the printed label next to them.

export interface TextBox { str: string; x: number; y: number; w: number; h: number } // PDF space, y = baseline

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const MAX = 90;

/**
 * The printed label for a field at `rect` ([x1, y1, x2, y2], PDF space). Checkboxes and radio
 * buttons look to the right first; other fields look above (labels printed in or over the box,
 * as on most tax forms), then to the left.
 */
export function labelFor(rect: number[], items: TextBox[], kind: "text" | "check"): string | null {
  const [x1, y1, x2, y2] = [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])];
  const words = items.filter((t) => clean(t.str));
  const cy = (y1 + y2) / 2;
  const sameLine = (t: TextBox) => t.y - t.h * 0.3 <= cy && t.y + t.h >= cy;
  // Everything on the row that starts at `first`, continuing while the gaps stay small.
  const row = (first: TextBox, dir: 1 | -1, limit: number) => {
    const onRow = words.filter((t) => Math.abs(t.y - first.y) < first.h * 0.4).sort((a, b) => a.x - b.x);
    let i = onRow.indexOf(first);
    const out = [first];
    for (let j = i + dir; j >= 0 && j < onRow.length; j += dir) {
      const prev = out[out.length - 1], t = onRow[j];
      const gap = dir > 0 ? t.x - (prev.x + prev.w) : prev.x - (t.x + t.w);
      if (gap > prev.h * 1.5 || (dir > 0 ? t.x > limit : t.x + t.w < limit)) break;
      out.push(t);
    }
    return clean((dir > 0 ? out : out.reverse()).map((t) => t.str).join(" "));
  };
  const right = () => {
    const c = words.filter((t) => sameLine(t) && t.x >= x2 - 1 && t.x - x2 < 24).sort((a, b) => a.x - b.x)[0];
    return c ? row(c, 1, x2 + 300) : null;
  };
  const left = (maxGap: number) => () => {
    const c = words.filter((t) => sameLine(t) && t.x + t.w <= x1 + 1 && x1 - (t.x + t.w) < maxGap).sort((a, b) => b.x + b.w - (a.x + a.w))[0];
    return c ? row(c, -1, x1 - 300) : null;
  };
  const above = () => {
    const reach = Math.max(14, (y2 - y1) * 1.5);
    const c = words
      .filter((t) => t.y >= cy && t.y - y2 < reach && t.x < x2 && t.x + t.w > x1 - 4)
      .sort((a, b) => a.y - b.y || a.x - b.x);
    if (!c.length) return null;
    const lineAt = (y: number, h: number) => words.filter((t) => Math.abs(t.y - y) < h * 0.4 && t.x < x2 && t.x + t.w > x1 - 4).sort((a, b) => a.x - b.x);
    // Take the whole label paragraph: keep going up while lines are tightly spaced.
    const lines = [lineAt(c[0].y, c[0].h)];
    for (let k = 0; k < 3; k++) {
      const top = lines[0][0];
      const next = words.filter((t) => t.y > top.y + top.h * 0.4 && t.y - top.y <= top.h * 1.4 && t.x < x2 && t.x + t.w > x1 - 4).sort((a, b) => a.y - b.y)[0];
      if (!next) break;
      lines.unshift(lineAt(next.y, next.h));
    }
    return clean(lines.map((l) => l.map((t) => t.str).join(" ")).join(" "));
  };
  // Text fields: a label just before the field on the same line ("tax year beginning ____") wins,
  // then one printed above, then anything further left.
  const order = kind === "check" ? [right, left(150), above] : [left(36), above, left(150), right];
  for (const f of order) {
    const s = f();
    if (s && /[\p{L}\p{N}]/u.test(s)) return s.length > MAX ? s.slice(0, MAX - 1).trimEnd() + "…" : s;
  }
  return null;
}
