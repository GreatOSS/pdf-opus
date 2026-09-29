// Fallback font for text the standard PDF fonts can't encode (Ł, Greek, Cyrillic, ✓ …).
// DejaVu Sans (Bitstream Vera licence, see public/fonts/LICENSE-DejaVu.txt), fetched on first use.
let bytes: Promise<Uint8Array> | null = null;
export function unicodeFontBytes(): Promise<Uint8Array> {
  bytes ??= fetch(`${import.meta.env.BASE_URL}fonts/DejaVuSans.ttf`)
    .then((r) => { if (!r.ok) throw new Error(`Couldn’t load the font (${r.status})`); return r.arrayBuffer(); })
    .then((b) => new Uint8Array(b));
  bytes.catch(() => { bytes = null; }); // retry next time (e.g. was offline)
  return bytes;
}

let face: Promise<{ hasGlyphForCodePoint(cp: number): boolean }> | null = null;
/** Characters the fallback font can't draw either. */
export async function missingGlyphs(chars: string[]): Promise<string[]> {
  face ??= Promise.all([import("@cantoo/fontkit"), unicodeFontBytes()]).then(([fk, b]) => ((fk as any).default ?? fk).create(b));
  face.catch(() => { face = null; });
  const f = await face;
  return chars.filter((ch) => !f.hasGlyphForCodePoint(ch.codePointAt(0)!));
}
