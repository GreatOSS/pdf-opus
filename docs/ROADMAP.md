# Roadmap

Guided by what users complain about in free PDF tools (reviews on TechRadar, Trustpilot, Capterra, AlternativeTo — checked 2026-09-29):
paywalls at save time, watermarks, daily limits, no way to edit existing text, Windows-only tools, slowness.
Leaflark's baseline answers the first three by design (free, local, unlimited, no watermark, cross-platform).

## Next
1. **Edit existing text** — v1 done 2026-09-29 (cover + retype with matched standard font). Next: remove original glyphs from the content stream, reuse embedded fonts when they contain the needed glyphs, multi-line paragraphs, Unicode via embedded fallback font.
2. **Redaction** — v1 done 2026-09-29 (text glyphs removed from page content streams, overlapping annotations deleted). Next: Form XObject text, image pixel erasure, redact search matches, metadata scrub.
3. ~~Page numbers / watermark~~ (done 2026-09-29); headers/footers with custom text and Bates numbering next.
4. **Compress** (image downsampling) and **OCR** for scanned PDFs (tesseract.js, lazy-loaded).
5. ~~Merge AcroForm fields when combining forms~~ (done 2026-09-29).
6. End-to-end tests (Playwright) for the workflows in docs/TESTING.md; run in CI.
7. Recent files list (IndexedDB, opt-in), presentation mode, print cross-browser verification.
8. Desktop packaging (Tauri) for native file association — local builds only while the repo is private.
