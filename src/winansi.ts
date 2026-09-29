// Characters the standard PDF fonts (WinAnsi encoding) can draw.
const WIN_ANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
/** Characters (deduplicated) that the standard PDF fonts can't encode. */
export const unsupportedChars = (text: string) =>
  [...new Set([...text].filter((ch) => {
    const c = ch.codePointAt(0)!;
    return !((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.includes(ch));
  }))];
