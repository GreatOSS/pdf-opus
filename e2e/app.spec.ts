import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";

async function samplePdf(pages = 3): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([612, 792]);
    p.drawText(`Hello Leaflark page ${i}`, { x: 72, y: 700, size: 24, font });
  }
  return Buffer.from(await doc.save());
}

async function open(page: Page, pages = 3) {
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({ name: "sample.pdf", mimeType: "application/pdf", buffer: await samplePdf(pages) });
  await expect(page.locator("#pageCount")).toHaveText(String(pages));
  await expect(page.locator(".page .textLayer span").first()).toBeVisible();
}

test("opens a PDF and shows pages and thumbnails", async ({ page }) => {
  await open(page);
  await expect(page).toHaveTitle("sample.pdf — Leaflark");
  await expect(page.locator(".thumb")).toHaveCount(3);
  await expect(page.locator(".thumb canvas").first()).toBeVisible();
});

test("rejects a non-PDF with a clear message", async ({ page }) => {
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hi") });
  await expect(page.locator(".toast.error")).toContainText("PDF");
});

test("finds text", async ({ page }) => {
  await open(page);
  await page.keyboard.press("ControlOrMeta+f");
  await page.locator("#findInput").fill("leaflark");
  await expect(page.locator("#findCount")).toHaveText(/of 3/);
  await page.locator("#findInput").fill("zebra");
  await expect(page.locator("#findCount")).toHaveText("No matches");
});

test("rotates, deletes and undoes page edits", async ({ page }) => {
  await open(page);
  await page.locator('.thumb[data-index="1"]').click();
  await page.locator("#pgRotR").click();
  await expect(page).toHaveTitle(/^• /);
  await expect.poll(() => page.evaluate(async () => (await (window as any).leaflark.doc.pdf.getPage(2)).rotate)).toBe(90);
  await page.locator('.thumb[data-index="0"]').click();
  await page.keyboard.press("Delete");
  await expect(page.locator("#pageCount")).toHaveText("2");
  await page.locator("#btnUndo").click();
  await expect(page.locator("#pageCount")).toHaveText("3");
});

test("adds text and saves it as a FreeText annotation", async ({ page }) => {
  await open(page);
  await page.locator("#toolText").click();
  const box = (await page.locator(".page").first().boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + 300);
  await page.keyboard.type("Reviewed");
  await page.keyboard.press("Escape");
  await expect(page).toHaveTitle(/^• /);
  // Force the download path (no File System Access API in this test).
  await page.evaluate(() => { delete (window as any).showSaveFilePicker; });
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#btnSave").click()]);
  const bytes = await (await download.createReadStream()).toArray();
  const pdf = Buffer.concat(bytes).toString("latin1");
  expect(pdf).toContain("/FreeText");
  await expect(page).toHaveTitle("sample.pdf — Leaflark");
});

test("adds page numbers", async ({ page }) => {
  await open(page);
  await page.locator("#btnMore").click();
  await page.locator("#miStamp").click();
  await page.locator(".ll-dialog button[type=submit]").click();
  await expect.poll(() => page.evaluate(async () => {
    const p = await (window as any).leaflark.doc.pdf.getPage(3);
    return (await p.getTextContent()).items.map((i: any) => i.str).join(" ");
  })).toContain("3");
});

test("mobile layout keeps tools reachable @mobile", async ({ page }) => {
  await open(page, 2);
  const tools = page.locator(".segmented");
  await expect(tools).toBeVisible();
  const vp = page.viewportSize()!;
  const tb = (await tools.boundingBox())!;
  expect(tb.y + tb.height).toBeGreaterThan(vp.height - 2);
  await expect(page.locator("#sidebar")).toHaveCSS("width", "0px");
});

test("edits existing text in place", async ({ page }) => {
  await open(page, 1);
  await page.keyboard.press("e");
  const span = page.locator(".page .textLayer span", { hasText: "Hello Leaflark" }).first();
  const b = (await span.boundingBox())!;
  await page.mouse.click(b.x + 10, b.y + b.height / 2);
  await expect(page.locator(".edit-box")).toHaveText("Hello Leaflark page 1");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Goodbye typo");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(async () => {
    const p = await (window as any).leaflark.doc.pdf.getPage(1);
    return (await p.getTextContent()).items.map((i: any) => i.str).join(" ");
  })).toContain("Goodbye typo");
  const text = await page.evaluate(async () => {
    const p = await (window as any).leaflark.doc.pdf.getPage(1);
    return (await p.getTextContent()).items.map((i: any) => i.str).join(" ");
  });
  expect(text).not.toContain("Hello Leaflark");
  await expect(page).toHaveTitle(/^• /);
});

test("edits text on a rotated page", async ({ page }) => {
  await open(page, 1);
  await page.locator("#thumbs [role=option]").first().click();
  await page.locator("#pgRotR").click();
  await expect.poll(() => page.evaluate(async () => (await (window as any).leaflark.doc.pdf.getPage(1)).rotate)).toBe(90);
  await page.keyboard.press("e");
  const span = page.locator(".page .textLayer span", { hasText: "Hello Leaflark" }).first();
  const b = (await span.boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + 10);
  const box = page.locator(".edit-box");
  await expect(box).toHaveText("Hello Leaflark page 1");
  const eb = (await box.boundingBox())!;
  // The box covers the (vertical) line of text.
  expect(Math.abs(eb.x + eb.width / 2 - (b.x + b.width / 2))).toBeLessThan(6);
  expect(eb.height).toBeGreaterThan(eb.width);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Turned text");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(async () => {
    const p = await (window as any).leaflark.doc.pdf.getPage(1);
    return (await p.getTextContent()).items.map((i: any) => i.str).join(" ");
  })).toContain("Turned text");
});

test("redacts text for real", async ({ page }) => {
  await open(page, 1);
  await page.locator("#toolRedact").click();
  const span = page.locator(".page .textLayer span", { hasText: "Hello Leaflark" }).first();
  const b = (await span.boundingBox())!;
  await page.mouse.move(b.x - 4, b.y - 4);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width + 4, b.y + b.height + 4, { steps: 5 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Apply 1 redaction" }).click();
  await page.locator(".ll-dialog button[type=submit]").click();
  await expect(page.locator(".toast").last()).toContainText("Redacted 1 area");
  const text = await page.evaluate(async () => {
    const p = await (window as any).leaflark.doc.pdf.getPage(1);
    return (await p.getTextContent()).items.map((i: any) => i.str).join(" ");
  });
  expect(text).not.toContain("Leaflark");
});

test("redaction marks can be drawn with touch @mobile", async ({ page, browserName }) => {
  await open(page, 1);
  await page.locator("#toolRedact").click();
  const b = (await page.locator(".page").first().boundingBox())!;
  const scrollBefore = await page.locator("#viewerContainer").evaluate((e) => e.scrollTop);
  if (browserName === "chromium") {
    // Real touch input (only Chromium exposes it), so native scrolling would show up too.
    const cdp = await page.context().newCDPSession(page);
    const pt = (x: number, y: number) => [{ x: b.x + x, y: b.y + y }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(20, 20) });
    for (let i = 1; i <= 6; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(20 + i * 20, 20 + i * 12) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    // Other engines: synthetic touch pointer events exercise the same handlers.
    await page.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x + 20, y + 20)!;
      const ev = (type: string, dx: number, dy: number) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x + dx, clientY: y + dy, button: 0, buttons: type === "pointerup" ? 0 : 1 });
      target.dispatchEvent(ev("pointerdown", 20, 20));
      for (let i = 1; i <= 6; i++) target.dispatchEvent(ev("pointermove", 20 + i * 20, 20 + i * 12));
      target.dispatchEvent(ev("pointerup", 140, 92));
    }, { x: b.x, y: b.y });
  }
  await expect(page.locator(".redact-mark:not(.drawing)")).toHaveCount(1);
  expect(await page.locator("#viewerContainer").evaluate((e) => e.scrollTop)).toBe(scrollBefore);
  await expect(page.getByRole("button", { name: "Apply 1 redaction" })).toBeVisible();
});

test("presents one page at a time and restores the view", async ({ page }) => {
  await open(page);
  await page.locator("#btnMore").click();
  await page.locator("#miPresent").click();
  await expect(page.locator("body")).toHaveClass(/presenting/);
  await expect(page.locator(".toolbar")).toBeHidden();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press(" ");
  await expect(page.locator(".page-input")).toHaveValue("3");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Escape");
  await expect(page.locator("body")).not.toHaveClass(/presenting/);
  await expect(page.locator(".toolbar")).toBeVisible();
  await expect(page.locator(".page-input")).toHaveValue("2");
});

test("remembers recent files only when asked to", async ({ page }) => {
  await open(page);
  await page.locator("#btnMore").click();
  await page.getByRole("menuitem", { name: "Close document" }).click();
  await expect(page.locator("#recent")).toBeHidden();
  await page.locator("#recentOn").check();
  await page.locator("#fileInput").setInputFiles({ name: "report.pdf", mimeType: "application/pdf", buffer: await samplePdf(2) });
  await expect(page.locator("#pageCount")).toHaveText("2");
  await page.locator("#btnMore").click();
  await page.getByRole("menuitem", { name: "Close document" }).click();
  await page.reload();
  await expect(page.locator(".recent-name")).toHaveText(["report.pdf"]);
  await page.locator(".recent-open").click();
  await expect(page).toHaveTitle("report.pdf — Leaflark");
});

test("prints every page as an image, then cleans up", async ({ page }) => {
  await open(page);
  await page.evaluate(() => { (window as any).__printed = 0; window.print = () => { (window as any).__printed++; }; });
  await page.keyboard.press("ControlOrMeta+p");
  await page.waitForFunction(() => (window as any).__printed === 1);
  await expect(page.locator("#printContainer .print-page img")).toHaveCount(3);
  await page.evaluate(() => dispatchEvent(new Event("afterprint")));
  await expect(page.locator("#printContainer")).toHaveCount(0);
  await expect(page.locator("#loading")).toBeHidden();
});

test("ships a Content-Security-Policy that keeps files on the device", async ({ page }) => {
  await page.goto("/");
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(csp).toContain("connect-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toContain("'unsafe-eval'"); // 'wasm-unsafe-eval' is fine
});

test("presentation can be left by touch @mobile", async ({ page }) => {
  await open(page);
  await expect(page.locator(".toolbar #btnSave")).toBeVisible();
  await page.locator("#btnMore").click();
  await page.locator("#miPresent").click();
  await expect(page.locator("#presentExit")).toBeVisible();
  await page.locator("#viewerContainer").click({ position: { x: 300, y: 300 } });
  await expect(page.locator(".page-input")).toHaveValue("2");
  await page.locator("#presentExit").click();
  await expect(page.locator("body")).not.toHaveClass(/presenting/);
  await expect(page.locator("#presentExit")).toBeHidden();
});

test("dark pages recolours the display only and is remembered", async ({ page }) => {
  await open(page);
  await page.locator("#btnMore").click();
  await page.locator("#miDarkPages").click();
  await expect(page.locator(".pdfViewer .page").first()).toHaveCSS("filter", /invert/);
  await page.reload();
  await expect(page.locator("body")).toHaveClass(/dark-pages/);
  await expect(page.locator("#miDarkPages")).toHaveText("Normal pages");
});

test("sticky notes can be added, edited and deleted", async ({ page }) => {
  await open(page, 1);
  await page.locator("#toolNote").click();
  const box = (await page.locator('.page[data-page-number="1"]').boundingBox())!;
  await page.mouse.click(box.x + 300, box.y + 200);
  const note = page.getByRole("textbox", { name: "Note" });
  await note.fill("Please check — Zoë");
  await note.press("Control+Enter");
  await expect(page.locator(".textAnnotation")).toHaveCount(1);
  await page.locator(".textAnnotation").click();
  await expect(note).toHaveValue("Please check — Zoë");
  await page.getByRole("button", { name: "Delete note" }).click();
  await expect(page.locator(".textAnnotation")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator("#toolNote")).toHaveAttribute("aria-pressed", "false");
});

test("notes tab lists notes and jumps to them", async ({ page }) => {
  await open(page, 3);
  await page.locator("#tabNotes").click();
  await expect(page.locator("#notesList")).toContainText("No notes");
  const tabs = page.locator(".sidebar-tabs");
  expect(await tabs.evaluate((t) => t.scrollWidth <= t.clientWidth)).toBe(true);
  await page.locator("#toolNote").click();
  const box = (await page.locator('.page[data-page-number="1"]').boundingBox())!;
  await page.mouse.click(box.x + 300, box.y + 200);
  await page.getByRole("textbox", { name: "Note" }).fill("Listed note");
  await page.getByRole("textbox", { name: "Your name" }).fill("Ana Łucja");
  expect(await page.locator("dialog").evaluate((d) => d.scrollWidth <= d.clientWidth)).toBe(true);
  await page.getByRole("button", { name: "Add note" }).last().click();
  await expect(page.locator(".note-item")).toHaveCount(1);
  await expect(page.locator(".note-item")).toContainText("Page 1 · Note · Ana Łucja");
  await page.locator(".textAnnotation").click();
  await page.getByRole("textbox", { name: "Reply" }).fill("A reply");
  await page.locator("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".note-item .note-reply")).toContainText("A reply");
  await expect(page.locator(".textAnnotation:visible")).toHaveCount(1); // one icon per thread
  await page.keyboard.press("Escape");
  await page.locator(".note-item").click();
  await expect(page.locator(".popupAnnotation:visible").first()).toContainText("Listed note");
  await expect(page.locator(".popupAnnotation:visible .popup-replies")).toContainText("A reply");
});
