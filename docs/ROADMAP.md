# Roadmap

Guided by what users complain about in free PDF tools (reviews on TechRadar, Trustpilot, Capterra, AlternativeTo — checked 2026-09-29):
paywalls at save time, watermarks, daily limits, no way to edit existing text, Windows-only tools, slowness.
Leaflark's baseline answers the first three by design (free, local, unlimited, no watermark, cross-platform).

## Next
1. **Edit existing text** — v1 done 2026-09-29 (retype with matched standard font). Original glyphs removed from the content stream and Unicode via an embedded fallback font (done); no cover box when every old glyph was removed, so tints/images behind the text survive (2026-09-30). Multi-line paragraphs: click any line, the whole paragraph opens and is rewrapped to its column (2026-09-30). Next: reuse embedded fonts when they contain the needed glyphs, keep justification, text drawn rotated within the page.
2. **Redaction** — v1 done 2026-09-29 (text glyphs removed from page content streams, overlapping annotations deleted). Form XObject text, metadata scrub and image pixel erasure (JPEG + Flate, incl. PNG predictors) done. Find & mark (redact every match) done. Inline images (BI…EI) under a mark removed (2026-09-30). Remaining: inline and JBIG2/CCITT images are removed whole rather than pixel-erased.
3. ~~Page numbers / watermark~~ (done 2026-09-29); ~~headers/footers with custom text and Bates numbering~~ (done 2026-09-30).
4. ~~Compress~~ (done 2026-09-30: Reduce file size) and ~~OCR~~ (done 2026-09-30: on-device; English, German, French, Spanish, Italian, Portuguese, Dutch; cancellable).
5. ~~Merge AcroForm fields when combining forms~~ (done 2026-09-29).
6. End-to-end tests (Playwright) for the workflows in docs/TESTING.md; run in CI.
7. ~~Recent files list (IndexedDB, opt-in)~~ (done 2026-09-30), ~~presentation mode~~ (done 2026-09-30), ~~print cross-browser~~ (done 2026-09-30: pages rendered to images instead of the browser’s PDF viewer).
8. Desktop packaging (Tauri) for native file association — local builds only while the repo is private.
9. ~~Sticky notes~~ (done 2026-09-30: add/edit/delete /Text notes). Notes list in the sidebar done 2026-09-30. Author name and replies done 2026-09-30.
