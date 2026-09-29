# Roadmap

Guided by what users complain about in free PDF tools (reviews on TechRadar, Trustpilot, Capterra, AlternativeTo — checked 2026-09-29):
paywalls at save time, watermarks, daily limits, no way to edit existing text, Windows-only tools, slowness.
Leaflark's baseline answers the first three by design (free, local, unlimited, no watermark, cross-platform).

## Next
1. **Edit existing text** (most requested gap): click a text run to replace it (cover + re-typeset with matching font where embeddable).
2. **Redaction** that really removes content (not just a black box).
3. ~~Page numbers / watermark~~ (done 2026-09-29); headers/footers with custom text and Bates numbering next.
4. **Compress** (image downsampling) and **OCR** for scanned PDFs (tesseract.js, lazy-loaded).
5. ~~Merge AcroForm fields when combining forms~~ (done 2026-09-29).
6. End-to-end tests (Playwright) for the workflows in docs/TESTING.md; run in CI.
7. Recent files list (IndexedDB, opt-in), presentation mode, print cross-browser verification.
8. Desktop packaging (Tauri) for native file association — local builds only while the repo is private.
