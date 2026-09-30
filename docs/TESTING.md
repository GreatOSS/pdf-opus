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


## 2026-09-29 (session 3)

| Workflow | Result |
|---|---|
| 800-page generated PDF | Open+first paint ~0.5 s, jump to p.700 85 ms, full-text search ~1.5 s, rotate a page ~1 s, JS heap ~37 MB |
| Keyboard: End/Home (real key presses) | OK |
| **New:** Edit text (E) on tracemonkey body line (Times) | Hover outline matches line; inline box in matching serif; replacement seamless; undo OK; scroll position kept |
| Edit text on centred bold sans heading (mime spec) | **Fixed:** replacement was left-anchored → now re-centred (detected against text-block centre, not page centre) |

| **New:** content-stream text removal — redact one line on p.1 of tracemonkey, mime, f1040, w9 (script, pdf.js re-extraction) | Target text gone in all 4; 0 of 834 other text items moved (>0.5pt) |
| **New:** Redact tool on W-9 header (drag, ×-remove mark, Apply → confirm) | 53 characters removed from the file, black box drawn, rest of page intact; undoable |
| Edit text now also removes the old glyphs | Verified by e2e (old string no longer extractable) |


## 2026-09-29 (session 5)

| Workflow | Result |
|---|---|
| Phone width 375px: 9 tools in bottom bar, Redact options | Fit OK |
| Redact with a finger drag (CDP touch events, e2e) | **Fixed:** the browser treated the drag as a scroll and cancelled the pointer, leaving a stuck half-drawn mark → `touch-action: none` while redacting + pointercancel cleanup |
| Redact with “Also remove document properties” on tracemonkey | 60 chars removed; Info dictionary and XMP gone |


## 2026-09-29 (session 6)

| Workflow | Result |
|---|---|
| Redact a header drawn via a shared Form XObject (3-page generated doc), page 1 only | **Fixed/new:** header text removed from p.1 (29 chars); pp.2–3 unchanged because the form is copied, not edited in place |
| **New:** “Apply the same areas to all pages” on the 3-page header doc | Header removed on all 3 pages (87 chars), body text intact |
| Real-file regression (tracemonkey, mime, f1040, w9) after recursion change | Unchanged: targets removed, 0 other items moved |

| Dark mode + Edit text on mime spec heading | OK — editor uses the page’s sampled colours (white/black), options pill themed |

### 2026-09-29 — Edit text with unsupported characters
- tracemonkey p1: typed “Łódź” in the title → error toast listing Ł ź, box stays open; retyped “Lodz title” → saved, text layer shows it. OK.

### 2026-09-29 — Offline
- Production build + preview, fresh profile: visit once, go offline, reload → app loads, opens w9.pdf, Redact tool (lazy chunk) and Find work. Before the fix: shell loaded but opening a PDF failed (worker/chunks never cached; `Vary: Origin` made cached assets miss). Fixed by build-time precache list + `ignoreVary`.
- With Redact active, its hint banner overlapped the Find bar's search box (w9, 1280px) → options bar now drops below Find while it is open; re-checked: no overlap, returns on close.

### 2026-09-29 — Mobile (390×780, touch) signature
- f1040 on phone layout: page, bottom tool bar OK. Sign dialog: “Remember on this device” checkbox was hidden (mobile rule meant for Find's Aa/Word boxes hid every `.chk`), so signatures were saved without the user seeing the option → rule scoped to the Find bar; re-checked: visible, Find boxes still hidden.

### 2026-09-29 — Keyboard-only sidebar
- tracemonkey, Tab from toolbar: every thumbnail's Rotate/Delete button was a Tab stop (2 per page) and the thumbnails themselves were unreachable. Now one Tab stop (current page, roving tabindex); ↓↓ → Page 3 + view follows; Delete removes it, Ctrl+Z restores; after scrolling to p6, Tab lands on Page 6. OK.

### 2026-09-29 — Form fill round trip
- f1040: typed “Jane” / “Doé” into two text fields, ticked a checkbox, Ctrl+S (download fallback) → reopened in Leaflark: values and checkbox kept. Rendered with Poppler (pdftoppm/pdftotext): both values incl. “é” and the tick visible. OK.

### 2026-09-29 — Page numbers & watermark
- tracemonkey via More → Page numbers & watermark (defaults + “CONFIDENTIAL”) → Apply → Save. Poppler: numbers 1/7/14 on pages 1/7/14, diagonal watermark present (faint at default opacity) on p1 and p7. OK.

### 2026-09-29 — Highlight + text box, checked in Poppler
- tracemonkey p1: highlighted the title, added text box “Reviewed ✓ ok”, saved. Poppler: highlight OK. Text box: pdf.js writes no appearance stream when the text has non-WinAnsi characters, so Poppler rebuilt it and dropped “✓” (other viewers may not show the box at all). ASCII text boxes get a proper appearance. Now: a one-time warning when leaving a text box with such characters (verified: one toast, none for ASCII). Real fix = embed a Unicode font (roadmap).

### 2026-09-29 — Drop image + PDF together
- Dropped a PNG and w9.pdf in one drag onto the start screen → “Combined.pdf”, 7 pages (image page first, then w9's 6), unsaved marker and “save to keep” toast. OK.

### 2026-09-29 — Touch drawing (390×780)
- tracemonkey, Draw tool, one-finger diagonal stroke (CDP touch): stroke drawn, page did not scroll, Undo enabled. OK. Draw/Text options panel on phones was 3 rows (~105px) → now 2 rows (74px): colours + Done, then labelled sliders. Checked Draw, Text, Redact panels at 390px.

### 2026-09-29 — Extract pages
- tracemonkey, More → Extract pages: “14-12, 99” → inline error “Pages must be between 1 and 14”; “2-4, 9” → download “tracemonkey (pages 2-4,9).pdf”, 4 pages (Poppler). OK. The dialog now states the page count up front.

### 2026-09-29 — Shortcuts dialog
- Dialog was missing E (Edit text), R (Redact) and Alt+↑/↓ (move pages) → added. Checked Alt+↓ on page 1 thumbnail moves it (p1 now “Hence, recording…”), Ctrl+Z restores. OK.

### 2026-09-29 — Two-page view + properties (1440×900)
- mime.pdf (19 p): Two-page view pairs 17|18, 19 alone; End → 19, ← → 17. Document properties: size, dates, creator/producer, PDF 1.5, page size in in/mm, tagged/form flags all shown. OK.

### 2026-09-29 — Insert blank page
- w9, select page 2, sidebar “+” → dialog “Insert after page 2” → Blank page: 7 pages, view on new p3, same size as neighbours. OK.

### 2026-09-29 — Add image
- w9 p1, Image tool → file chooser opens straight away → PNG (680×880) placed, Save → Poppler shows it, embedded at full resolution. OK. pdf.js placed new images at up to ~75% of the page, burying the form → Leaflark now picks the file itself and places the image at its own size (96 dpi), max 40% of page width, centred in the visible part of the current page. Re-checked: PNG on p2 at 40% width, centred in view, undoable; SVG logo at natural size; both in the saved PDF (pdfimages).

### 2026-09-29 — Outline
- mime.pdf, Outline tab: tree with collapsible sections, “3. Contributors” → page 18. OK. On p1 the highlight was the last section starting on the page (1.2) → now follows the section at the top of the view while scrolling (1 → 1.1 → 1.2), clicking an entry highlights it. Expand arrows were mismatched ▼/► glyphs → CSS chevrons, checked collapsed + expanded.

### 2026-09-29 — Find options
- mime.pdf, “mime”: 160 matches; Aa 64; Aa+Word 46; Word 129 (current match kept when toggling); nonsense → “No matches”. OK.

### 2026-09-29 — Broken files
- Text file renamed .pdf, and tracemonkey truncated to 40 KB: each gives “‘name’ is not a valid PDF or is damaged.”, start screen stays usable. Poppler can't open the truncated file either. OK.

### 2026-09-29 — Tablet widths
- iPad portrait (834×1112): desktop toolbar didn't fit — More (⋮) pushed off-screen (menu unreachable), sidebar/Open buttons clipped, page number overlapping “of 6”. Toolbar fits only from ~950px. Compact layout (bottom tool bar, overlay sidebar) now applies up to 960px (was 820). Re-checked 834/960/961/1024: no control off-screen, More reachable, Highlight options OK. Then restored page count, zoom menu and Open on 700–960px (room to spare; checked 700/768/834/960).

### 2026-09-29 — Phone landscape (780×360)
- Sign dialog: “Place signature” was below the screen edge (dialog had to be scrolled while drawing). Pad now shrinks with screen height, same shape → 336×120 pad, buttons in view (bottom 331px); drew a stroke and placed it. Portrait phone and desktop sizes unchanged.

### 2026-09-29 — Typed signature, long name
- “Maximilian Alexander Featherstonehaugh-Worthington”: font previews cut the name off with “…” → previews now shrink to fit (27–30px), full name visible; short names stay 32px. Placed a typed “Jane Q. Public”: ~2.2in wide, centred on the click; saved → Poppler shows it at the same spot. OK.

### 2026-09-29 — Redaction undo/redo
- tracemonkey p1: R, marked the title, Apply → confirm (mentions undo until close, image caveat) → title text gone from text layer; Ctrl+Z → back; Ctrl+Y → gone again. OK.

### 2026-09-29 — Save as without file picker (Firefox/Safari path)
- With `showSaveFilePicker` removed, Ctrl+Shift+S just re-downloaded under the same name. Now asks for a name (prefilled “w9.pdf”); “bad/name” → inline error; “W-9 signed” → download “W-9 signed.pdf”, title updated, later Ctrl+S keeps the new name. Print: hidden iframe created, no errors (dialog itself not checkable headless).

### 2026-09-29 — Firefox
- Installed Playwright Firefox 155; all 8 desktop e2e tests pass (open, bad file, find, page edits + undo, text box save, page numbers, Edit text, redaction). Firefox project added to CI. WebKit (Safari engine; needed ~135 system libs via agent-packages): all 8 pass too, added to CI. iPhone 14 profile (WebKit) runs the @mobile tests (layout, touch redaction via synthetic touch pointer events — CDP touch is Chromium-only): pass.

### 2026-09-30 — Edit text with Unicode
- Edit text now embeds a subset of DejaVu Sans (loaded on demand, +~11 KB per file) for characters outside WinAnsi. tracemonkey p1: title → “Łódź ✓ Ωμέγα” → Poppler renders it and pdftotext extracts it; pdffonts shows DejaVuSans CID TrueType embedded. “日本” still refused with a message (not in DejaVu), box stays open. Found on the way: this pdf-lib fork's `encodeText` never threw, so the old “?” fallback never fired — now uses an explicit WinAnsi check. Limits: the fallback is DejaVu Sans Regular only (a bold serif heading becomes regular sans); text boxes: see next entry.

### 2026-09-30 — Centred text detection
- tracemonkey's long centred title wasn't detected as centred (needed ≥8% page-width indent; it's 26pt in) → replacement was left-aligned. Now: centred when indented ≥3% and the gaps on both sides are equal (vs text block or page). Unit tests for title, short heading, columns, first-line indent, flush-left. Re-checked: edit box opens centred, “Łódź Tracing ✓” lands centred above “Languages”.

### 2026-09-30 — Text boxes with Unicode
- On save, text boxes pdf.js left without an appearance (non-WinAnsi text) now get one drawn with the DejaVu subset. tracemonkey: “Reviewed ✓ Łódź” + “Ωμέγα line 2” → Poppler renders both lines (first try clipped “Łódź”: pdf.js sized the box for Helvetica → text now shrinks to fit the box width). ASCII boxes keep pdf.js's own appearance. “日本 ✓” → one warning (CJK not in DejaVu; was shown 2–3× — toasts now de-duplicate). Reopened the saved file in Leaflark: boxes display.

### 2026-09-30 — Redaction erases image pixels
- Dropped a generated 800×600 JPEG with “SECRET 123-45-6789” → marked the text band → Redact: toast “1 image erased underneath”; saved; `pdfimages -png` of the saved file shows the band black *in the image itself*, text gone. Unit tests: Flate RGB with and without PNG predictor (only covered pixels zeroed, a second page sharing the image keeps the original), undecodable image → removed whole, images outside marks untouched. Confirm dialog no longer says images are only covered.

### 2026-09-30 — Redact: Find & mark
- New “Find & mark…” in the Redact tool marks every (case-insensitive) occurrence. w9 “taxpayer”: 12 marks on 5 pages → applied → pdftotext: 0 left (was 12). First version estimated extents with equal-width characters and left a stray “r” of a bold “Taxpayer” → now uses proportional widths from canvas text measurement (item's font family) scaled to pdf.js's item width, plus 0.4-char padding; re-run: no fragments, neighbours (“Identification Number (TIN)”) intact. tracemonkey “trace”: 416 → 0; substring semantics (“traces” keeps its “s”). Limits: matches spanning two text items and rotated text aren't found (rotated ones are counted and reported).

### 2026-09-30 — Reduce file size
- New More → “Reduce file size…” (Balanced: long edge ≤2600 px, JPEG q0.82; Smallest: ≤1600 px, q0.7). Dropped a generated 4000×3000 noisy JPEG (6.1 MB PDF) → Balanced → “Reduced from 6.1 MB to 874 KB (1 image recompressed)”; saved: pdfimages shows 2600×1950 JPEG, Poppler render looks right. tracemonkey (no photos) → 1.0 MB → 964 KB from object streams alone. Lossless (Flate) images are only downscaled, never turned into JPEG; CMYK JPEGs, masks, Decode arrays are left alone; an image is only replaced if ≥10% smaller; the whole step is undoable.

### 2026-09-30 — OCR
- New More → “Recognize text (OCR)…” (tesseract.js 7, LSTM, English; engine + data served from /ocr, ~7 MB, fetched on first use, not precached). Scan test: W-9 p1 rendered to PNG at 150 dpi → opened as image PDF → OCR: dialog says 1 page looks like a scan; ~8 s; 916 words; Find “Taxpayer” → 1 of 3; saved → pdftotext gives the text (903 words vs 933 in the original page; e.g. “Mame” for “Name”). Placement tuned in three rounds: baseline at word bottom (7pt low) → line baseline (title too tall: the line included the big “W-9”) → per-word size/baseline from ascender/descender classes: highlights now sit on the words (within ~2–3pt). Limits: English only; non-WinAnsi letters in results become “?”.

### 2026-09-30 — OCR cancel
- Loading indicator can now show a Cancel button (used by OCR). 3-page scan (W-9 p1–3 at 150 dpi): cancelled during page 2 → first try hung (terminating tesseract's worker never settles the pending `recognize`) → now raced against a cancel promise: “Text recognition cancelled — nothing was changed.” within ~0.3 s, no undo step. Re-running afterwards: 3 pages, 3524 words, ~8 s/page.

### 2026-09-30 — OCR languages
- OCR dialog has a “Document language” select: English, German, French, Spanish, Italian, Portuguese, Dutch (tesseract best_int data, 0.7–3 MB each, served from /ocr/lang). Default guessed from the browser locale, last choice remembered. fr-FR context → French preselected; generated French invoice scan → 34 words, all accents right (“Élève”, “François Lefèvre”, “Besançon”, “dû”, “€”, “bientôt”) in the rebuilt text layer. unit 41/41, e2e 28/28 (5 engines).

### 2026-09-30 — Redact: inline images
- Inline images (BI…EI in the content stream) under a mark were left in the file. Now any inline image a mark touches is removed whole (they're small by spec; counted in the "removed completely" toast); Edit text doesn't touch them. Hands-on: generated PDF with two inline 16×16 images + text → marked part of the big one in the app → toast “1 image … removed completely” → saved: pdfimages lists only the other inline image, pdftotext text intact, Poppler render shows black box + untouched second image. unit 42/42.

### 2026-09-30 — Find & mark across text pieces
- Find & mark only matched inside a single pdf.js text item, so a phrase the PDF splits (font change, separate space item, kerning) was missed, and the user could think every occurrence was marked. Items on the same baseline are now joined into lines (whitespace collapsed, a space inferred for word gaps); a match gets one mark per piece; the toast counts matches, not pieces. Hands-on: generated PDF “Account number:” + “ ” + bold “4417 1234” → “number: 4417”: 1 match (3 areas), applied + saved → pdftotext “Account ⎵ 1234 (primary)”; “4417 1234” on consecutive lines is (correctly) not matched. Regression: tracemonkey “trace” still 416 on 14 pages; W-9 “taxpayer identification number” 5 on 3 pages. unit 43/43.

### 2026-09-30 — Phone pass: Print was unreachable
- 390×844 touch: open W-9, toolbar, bottom tool bar (8 tools incl. Redact), More menu — clean, no errors. Found: the Print button is hidden below 1100 px with no other way in (phones, tablets, narrow windows; only Ctrl+P). Added “Print…” to the More menu, shown only at those widths; menu arrow keys now skip hidden items. Verified: 390 px → More → Print… closes the menu and creates the print frame; 1280 px → item hidden, ArrowDown from “Save as…” lands on “Extract pages…”.

### 2026-09-30 — Tablet form fill: non-Latin-1 names
- 820×1180 touch, f1040: tapped fields and typed; 2-char year field truncated correctly; checkbox saved. Found: a value with “Ł” (outside WinAnsi) was saved with no appearance stream — pdf.js drops it and sets NeedAppearances; Poppler then rebuilt it and printed “Zoë Müller-ukasz”, and viewers that don't rebuild would show the field empty. Now such text fields get an appearance in the embedded DejaVu subset (DA size/colour, auto size, Q alignment, multiline wrap, /Tx BMC), and NeedAppearances is cleared when every filled field has one. Verified: “Zoë Łukasz”, “Główna 12” render in Poppler (no font warning), ASCII fields keep pdf.js's appearance, reopened in Leaflark with values intact. Limit: fallback font is regular weight, so it doesn't match bold field fonts. unit 45/45.

### 2026-09-30 — Dark mode pass (newer dialogs)
- 1280×800, prefers-color-scheme dark, tracemonkey: “Reduce file size” dialog and Redact → “Find & mark” prompt + tool options bar — legible contrast, focus ring visible, buttons consistent, no console errors. No changes needed.

### 2026-09-30 — Keyboard-only pass (W-9)
- Tab from page start: sidebar resizer → page → link → every form field in reading order (text fields, checkbox group, textarea) → next page; focus ring on all interactive stops. Finding: W-9 fields have no /TU tooltip, so screen readers only get internal names (“topmostSubform[0].Page1[0].f1_01[0]”); pdf.js uses /TU when present. Not fixed (would need labels inferred from nearby text).

### 2026-09-30 — Accessible names for form fields
- Fields without a /TU tooltip now get an aria-label from the printed label (checkboxes: text to the right; text fields: text just before on the same line, else the label paragraph above, else further left). Checked the labels exposed on W-9 and 1040 p1: W-9 “1 Name of entity/individual. An entry is required…”, “2 Business name/…”, all 3a checkboxes (“C corporation”, “Partnership”…), “Exempt payee code (if any)”, “6 City, state, and ZIP code”, “Employer identification number”; 1040 “…other tax year beginning”, “, 2025, ending”, “Your first name and middle initial”, “Last name”, “Home address …”. Imperfect: W-9 LLC classification box → “Trust/estate”, first SSN digit box → nearby paragraph, 1040 date comb boxes → “Deceased MM / DD /…”. Fields with /TU keep pdf.js's label. unit 49/49.

### 2026-09-30 — Find & mark: rotated text
- Rotated text was skipped. Items are now grouped by text direction and matched in their own frame (so phrases split across rotated items are found too), then mapped back to page space; only slanted/mirrored text is still skipped (toast says so). Hands-on: W-9 “specific instructions” — the vertical sidebar on pages 1 and 2 → “Marked 2 matches on 2 pages”, vertical marks sit on the words → applied, saved → pdftotext: 0 (was 2), neighbours “Print or type.”, “on page 3.” intact. Unit: 90°, 180°, split rotated phrase, mirrored skipped. unit 49/49.

### 2026-09-30 — Firefox: organize pages
- Firefox (Playwright), tracemonkey 14 pp: thumbnail 2 → Rotate right; thumbnail 3 → Delete key (undoable, no prompt); drag thumbnail 1 onto thumbnail 4 (orig p5); Ctrl+S. App: “of 13”, moved page selected and shown. Saved file: 13 pages; p1 = orig p2 with /Rotate 90; orig p3 gone; order orig 2, 4, 1, 5, … (drop inserts before the target). No console errors. No changes needed.

### 2026-09-30 — Bold Unicode fallback
- Added DejaVu Sans Bold: used for bold Edit-text runs and for form fields whose DA font is bold (e.g. /HelveticaLTStd-Bold). First try never matched: the DA PDF string stringifies with its parentheses, so the “starts with /” pattern failed — caught by the new unit test. 1040: “Zoë Łukasz” saved → pdffonts DejaVuSans-Bold subset, Poppler render matches the weight of the neighbouring bold “Müller-Wójcik”. Both DejaVu files (~1.5 MB) left out of the service-worker precache (cached on first use), so first visits download less. unit 50/50.

### 2026-09-30 — Edit text: bold/italic detection
- Checked the Edit-text bold path left open last time: tracemonkey “Abstract” (NimbusRomNo9L-Medi) → typed “Łódź Abstract” → saved with regular DejaVu, i.e. the heading wasn't seen as bold at all — the name check only knew bold/black/heavy/semibold/demi, so URW “Medi”, TeX CMBX, “Bd” were treated as regular (and “Ital”, CMTI as upright), also for plain-ASCII edits (bold heading re-typed in regular Times). Now uses pdf.js's bold/black/italic flags plus a broader name check (“Medium” stays regular). Re-test: edit box weight 700, saved PDF embeds DejaVuSans-Bold subset, Poppler render bold. unit 51/51.

### 2026-09-30 — WebKit: text box + typed signature
- WebKit (Playwright, Safari engine), tracemonkey p1: Add text → click → typed “WebKit note”; Add signature → Type tab → “Ada Lovelace” → Place signature → click on page (move/resize handles, Alt text button shown); Save → download. Saved file has a FreeText and a Stamp annotation; Poppler renders both where placed. No console errors. No changes needed.

### 2026-09-30 — Headers/footers & Bates numbers
- More → “Page numbers, headers & watermark…”: new Format “Custom text…” shows a Text field ({n}, {n:6} zero-padded, {total}); new position Top left. tracemonkey: “ACME-{n:6} · Łódź office”, Top right, start 42 → saved: pdftotext p1 “ACME-000042 · Łódź office”, p14 “ACME-000055 …”; non-WinAnsi text uses the DejaVu subset (pdffonts), Poppler render clean. Template field hidden unless Custom is chosen. unit 52/52.

### 2026-09-30 — Presentation mode
- More → Present: full screen (where the browser allows), toolbar/sidebar hidden, black background, one page fitted. tracemonkey: →, Space → p3; click → p4; ← → p3; Esc → leaves full screen, layout and “Automatic” zoom restored, stays on p3. 16:9 slide deck (generated 960×540): first version sat at the top (38 px above / 66 px below) → viewer centred and its padding removed → 52/52 px. New e2e test (desktop Chromium, WebKit, Firefox). unit 52/52, e2e 31/31.

### 2026-09-30 — Recent files (opt-in)
- Welcome screen: “Remember recent files on this device” (off by default; turning it off erases the list). Chrome/Edge keep only the file handle (re-asks permission); elsewhere a copy (≤50 MB) in IndexedDB. Hands-on (Chromium): off → open/close tracemonkey → nothing listed; on → open w9, tracemonkey → reload → list “tracemonkey.pdf, w9.pdf” with times → click w9 → reopens, moves to top → × removes an entry → uncheck → list hidden, store empty. New e2e test failed on WebKit: Blobs can't be stored in IndexedDB in ephemeral/private sessions → store ArrayBuffer instead; passes on Chromium, WebKit, Firefox. unit 52/52, e2e 34/34.

### 2026-09-30 — Printing rebuilt
- Print used to load the PDF into a hidden iframe and call the browser's PDF viewer — downloads instead of printing on Android Chrome (no viewer) and wherever the viewer is disabled, and known to print blank/first page only from iframes in Safari. Now every page is rendered at 150 dpi (print intent, current form values/annotations) into a print-only container (@page sized from page 1), with progress + Cancel; cleaned up on afterprint. Verified by stubbing window.print and printing the print-media page to PDF in Chromium: f1040 with typed “Zoë Printtest” + checked box → 2 Letter pages, both values visible; tracemonkey → 14 pages, ~1 s; 16:9 slides → 960×540 pages. New e2e test in Chromium, WebKit, Firefox. Remaining: real printers/dialogs untested (headless).

### 2026-09-30 — Content-Security-Policy
- Built pages now carry a CSP (injected at build; dev server exempt for HMR): default/script/connect 'self' (+ 'wasm-unsafe-eval' for pdf.js decoders and OCR, blob: workers for tesseract), no eval, no plugins/frames/forms. Backs up “files never leave this device” even against injected script. Hands-on against `vite preview`: scan → OCR (7 words), Edit text “Łódź” (DejaVu fetch), typed signature (web font), print, save — zero securitypolicyviolation events, no console errors. Cross-origin fetch and image load from the page are blocked. Full e2e suite (runs on the built preview) 40/40 with the policy in place, incl. a new check of the policy itself.

### 2026-09-30 — Phone pass: recent files, presentation, print (production build)
- 390×844 touch on `vite preview`: recent files on → w9, tracemonkey listed (long name ellipsised) → tap reopens; Present; print → 14 pages prepared. Found: (1) the welcome “Open a PDF” button was a bare folder icon on phones — the narrow-screen rule hiding the toolbar Save label also hit it → scoped to the toolbar; (2) presentation could only be left with Esc — on iPhone (no Fullscreen API, no keyboard) there was no way out, and the toast talked about arrow keys. Added a × exit button, left-third tap = back, swipes, touch wording in the toast. Re-test: button reads “Open a PDF”; tap → 2 → 3, left tap → 2, swipe left → 3 (not double-counted), × exits and hides. New @mobile e2e (Pixel 7, iPhone 14). e2e 42/42.

### 2026-09-30 — Dark pages (night reading)
- More → “Dark pages”: pages shown light-on-dark (CSS invert + hue-rotate on the page element, so text, figures, form fields and marks stay consistent); display only — saving and printing unaffected. tracemonkey p2 in dark mode: text and the Figure 2 diagram legible, colours recognisable. Setting survives reload; menu then reads “Normal pages”. New e2e (3 desktop engines).

### 2026-09-30 — Crop pages
- More → “Crop pages…”: trim white margins automatically (render at 0.75×, find non-white bounds, 9 pt padding) or custom margins in mm (as displayed; rotation-aware via the viewport), all or selected pages; sets CropBox (drops stale Trim/ArtBox); undoable. tracemonkey auto, all 14 pages: ~1.2 s, “Cropped 14 pages.”, pdfinfo p1 CropBox 44,58–566,724, render tight with text intact; Ctrl+Z restores full page; thumbnail 1 selected → dialog defaults to “Selected pages (1)” → custom 20 mm → p1 CropBox 56.69 pt in, p2 untouched. Dialog: margin fields hidden unless Custom is chosen (first version showed them greyed out). unit 55/55.

### 2026-09-30 — Save pages as images
- More → “Save pages as images…”: current/selected/all pages, PNG or JPEG, 96/150/300 dpi (capped at 8000 px per side); one page → image file, several → ZIP (own store-only writer, UTF-8 names); includes form entries/annotations; progress + Cancel. f1040 with typed “Zoë Imagetest”, current page, PNG 150 dpi → “f1040 - page 1.png” 1275×1650 with the value rendered. tracemonkey all pages, JPEG → “tracemonkey (images).zip” in 0.8 s; `unzip -t`: no errors; 14 files “tracemonkey - page 01.jpg” … valid 1275×1650 JPEGs. Opening another file with unsaved edits correctly asked “Discard unsaved changes?”. unit 57/57.

### 2026-09-30 — Firefox + WebKit: crop, images, dark pages (production build)
- Both engines on `vite preview` (CSP active), tracemonkey: Crop → auto → “Cropped 14 pages.”; Save pages as images → all, JPEG → “tracemonkey (images).zip”, `unzip -t` OK for both; Dark pages → filter applied, pages render light-on-dark. No page errors. No changes needed.

### Known gaps / next
- Redaction: JBIG2/CCITT and inline images under a mark are removed whole (not pixel-erased). Edit text: CJK and other scripts DejaVu Sans lacks are refused with a message; rotated text/pages not editable yet.
- Printing renders pages to images (150 dpi); the print dialog and real printers can't be exercised headless; real Safari untested.
- Inferred form-field labels are heuristic; small boxes inside dense rows can pick up a neighbour's label.
