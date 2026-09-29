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

test("redaction marks can be drawn with touch @mobile", async ({ page }) => {
  await open(page, 1);
  await page.locator("#toolRedact").click();
  const b = (await page.locator(".page").first().boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const scrollBefore = await page.locator("#viewerContainer").evaluate((e) => e.scrollTop);
  const pt = (x: number, y: number) => [{ x: b.x + x, y: b.y + y }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(20, 20) });
  for (let i = 1; i <= 6; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(20 + i * 20, 20 + i * 12) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.locator(".redact-mark:not(.drawing)")).toHaveCount(1);
  expect(await page.locator("#viewerContainer").evaluate((e) => e.scrollTop)).toBe(scrollBefore);
  await expect(page.getByRole("button", { name: "Apply 1 redaction" })).toBeVisible();
});
