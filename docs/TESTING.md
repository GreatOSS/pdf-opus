# Hands-on test log

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

### Known gaps / next
- No automated end-to-end tests yet (only unit tests for page operations).
- Print uses the browser’s PDF viewer in a hidden iframe; needs cross-browser verification (Firefox, Safari).
- No offline service worker yet.
