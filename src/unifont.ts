// Fallback font for text the standard PDF fonts can't encode (Ł, Greek, Cyrillic, ✓ …).
// DejaVu Sans and Sans Bold (Bitstream Vera licence, see public/fonts/LICENSE-DejaVu.txt), fetched on first use.
const loaded = new Map<boolean, Promise<Uint8Array>>();
export function unicodeFontBytes(bold = false): Promise<Uint8Array> {
  let bytes = loaded.get(bold);
  if (!bytes) {
    bytes = fetch(`${import.meta.env.BASE_URL}fonts/DejaVuSans${bold ? "-Bold" : ""}.ttf`)
      .then((r) => { if (!r.ok) throw new Error(`Couldn’t load the font (${r.status})`); return r.arrayBuffer(); })
      .then((b) => new Uint8Array(b));
    loaded.set(bold, bytes);
    bytes.catch(() => loaded.delete(bold)); // retry next time (e.g. was offline)
  }
  return bytes;
}

let face: Promise<{ hasGlyphForCodePoint(cp: number): boolean }> | null = null;
/** Characters the fallback font can't draw either. */
export async function missingGlyphs(chars: string[]): Promise<string[]> {
  face ??= Promise.all([import("@cantoo/fontkit"), unicodeFontBytes(false)]).then(([fk, b]) => ((fk as any).default ?? fk).create(b));
  face.catch(() => { face = null; });
  const f = await face;
  return chars.filter((ch) => !f.hasGlyphForCodePoint(ch.codePointAt(0)!));
}
