# Hands-on test log

Automated coverage: `npm test` (unit: page ops, forms merge, encryption, stamping) and `npm run e2e` (Playwright: open, bad file, search, rotate/delete/undo, add text + save download, page numbers, mobile layout). Both run in CI.

Concise record of what was actually exercised in the running app, and known remaining problems.
Samples used: pdf.js `tracemonkey` paper (14 pages, text), IRS Form 1040 (AcroForm, 2 pages), IRS W-9, shared-mime-info spec.

## 2026-09-29 — v0.1.0 (Chromium via Playwright, 1400×900, 1280×720 and 390×800)

| Workflow | Result |
|---|---|
| Welcome screen, open via `?file=` | OK |
| Opening a non-PDF | Clear “not a valid PDF” toast |
| Search: Ctrl+F, type, Enter/Shift+Enter | OK — “2 of 416”, all matches highlighted |
| Highlight selected text (H) | OK. **Fixed:** pdf.js editor toolbar icon was offset ~110px (CSS clash) |
| Add text (T), type, Esc | OK |
| Undo button state | **Fixed:** listened to renamed pdf.js event (`editingstateschanged`) |
| Rotate page from sidebar | OK, page and selection kept, title shows unsaved dot |
| Drag thumbnail to reorder | OK (1 → after 3) |
| Ctrl+Z undoes page move, redo enabled | OK |
| Fill 1040 text field + checkbox, save, reopen | Values preserved |
| Rotate page of filled form | Form fields and values preserved |
| Unsaved changes → reload | Browser prompts |
| Phone width 390px | **Fixed:** toolbar overflow, sidebar covering page, form widgets painting over sidebar. Tools now in bottom bar |
| Dark mode | OK |
| Layout clash with pdf_viewer.css `.sidebar/.dialog/.swatch` | **Fixed** (prefixed classes) |

| Sign: draw signature, place by click | **Fixed:** first placement was ~page-wide and anchored at corner; now ~2.2in wide, centred on click |
| Sign: saved signature reused from library, typed signature (3 bundled fonts) | OK; saved as `/Stamp` annotation (verified after save + reopen) |
| Typed-signature fonts on Linux | **Fixed:** system fallbacks looked identical; bundled OFL Great Vibes / Dancing Script / Caveat (Latin subset, woff2) |

| Password PDF: wrong password → retry prompt → correct password | OK |
| Password PDF: delete page | **Fixed:** output was unreadable (pdf-lib can’t decrypt). Switched to `@cantoo/pdf-lib`; edits decrypt with the entered password and re-encrypt with it |
| Page tree flattening with inherited MediaBox/Rotate | Covered by unit test |

| Production build (`vite preview`): open, rotate (lazy-loaded pdf-lib), service worker registers | OK. **Fixed:** relative pdf.js asset URL broke ICC wasm in the worker |
| Open 3 files at once (W-9 PDF + PNG + 1040 PDF) | Combined into 9 pages, image page sized 600×450pt, 1040 widgets still render |


## 2026-09-29 (session 2)

| Workflow | Result |
|---|---|
| Outline (mime spec, 3 levels): click entry, expand section | Navigation OK. **Fixed:** 184px sidebar wrapped titles badly and scrolled horizontally → sidebar is now resizable (drag edge / ←→ on handle, persisted), outline wraps cleanly, thumbnails scale with width |
| Reading position in outline | **New:** current section highlighted and revealed while scrolling; auto-expanded sections collapse again |
| More → Document properties | OK |
| Closed sidebar | **Fixed:** 1px border line remained visible (caught by e2e) |
| Combine W-9 + 1040 + 1040 (421 fields), type into 2nd 1040 copy | **Fixed:** fields now registered in AcroForm (were only widgets); clashing names suffixed “(2)/(3)” so copies don’t share values; stale XFA dropped |
| More → Page numbers & watermark on a doc with a 90°-rotated page | **New.** Numbers upright at visual bottom-centre on rotated page, diagonal watermark; undoable |

### Known gaps / next
- Print uses the browser’s PDF viewer in a hidden iframe; needs cross-browser verification (Firefox, Safari).
- No offline service worker yet.
