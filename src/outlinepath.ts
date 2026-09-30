// Index-path arithmetic for moving bookmarks (kept free of pdf-lib so the UI can use it without loading it).
export type MoveOp = "up" | "down" | "in" | "out";

/**
 * Where a move sends the bookmark at `path` (in the tree after it's been taken out), or null if it can't go that way.
 * `prevKids` is the number of children of the previous sibling (it becomes the new parent for "in").
 */
export function moveTarget(path: number[], op: MoveOp, siblings: number, prevKids: number): number[] | null {
  const i = path[path.length - 1], up = path.slice(0, -1);
  if (op === "up") return i > 0 ? [...up, i - 1] : null;
  if (op === "down") return i < siblings - 1 ? [...up, i + 1] : null;
  if (op === "in") return i > 0 ? [...up, i - 1, prevKids] : null;
  return up.length ? [...up.slice(0, -1), up[up.length - 1] + 1] : null;
}

/** Where the entry at `p` ends up after the bookmark at `from` moves to `to` (see moveTarget). */
export function remapPath(p: number[], from: number[], to: number[]): number[] {
  const starts = (q: number[], pre: number[]) => pre.every((v, i) => q[i] === v);
  if (p.length >= from.length && starts(p, from)) return [...to, ...p.slice(from.length)];
  const q = [...p];
  const fd = from.length - 1, td = to.length - 1;
  if (q.length > fd && starts(q, from.slice(0, fd)) && q[fd] > from[fd]) q[fd]--;
  if (q.length > td && starts(q, to.slice(0, td)) && q[td] >= to[td]) q[td]++;
  return q;
}
