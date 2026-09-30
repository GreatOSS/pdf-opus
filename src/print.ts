// Printing: render every page to an image and print those through a print-only stylesheet.
// Handing the PDF to the browser's own viewer in an iframe fails on Android Chrome (downloads it),
// iOS/macOS Safari (blank or first page only) and wherever the built-in viewer is turned off.
import { AnnotationMode, type PDFDocumentProxy } from "pdfjs-dist";

const DPI = 150;

export async function printDocument(pdf: PDFDocumentProxy, onProgress: (done: number, total: number) => void, signal: { cancelled: boolean }): Promise<boolean> {
  document.getElementById("printContainer")?.remove();
  const container = document.createElement("div");
  container.id = "printContainer";
  const urls: string[] = [];
  const cleanup = () => { container.remove(); urls.forEach((u) => URL.revokeObjectURL(u)); };
  // Form values and annotations as currently edited, frozen for printing.
  const printStorage = (pdf.annotationStorage as any).print ?? pdf.annotationStorage;
  try {
    const first = (await pdf.getPage(1)).getViewport({ scale: 1 });
    const style = document.createElement("style");
    style.textContent = `@page { size: ${first.width}pt ${first.height}pt; margin: 0; }`;
    container.append(style);
    for (let i = 1; i <= pdf.numPages; i++) {
      if (signal.cancelled) { cleanup(); return false; }
      onProgress(i - 1, pdf.numPages);
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: DPI / 72 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport, intent: "print", annotationMode: AnnotationMode.ENABLE_STORAGE, printAnnotationStorage: printStorage } as any).promise;
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      canvas.width = canvas.height = 0; // free the memory now
      if (!blob) throw new Error("Couldn’t render page " + i);
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      const wrap = document.createElement("div");
      wrap.className = "print-page";
      wrap.append(img);
      container.append(wrap);
    }
    document.body.append(container);
    await Promise.all([...container.querySelectorAll("img")].map((im) => im.decode().catch(() => {})));
    if (signal.cancelled) { cleanup(); return false; }
    onProgress(pdf.numPages, pdf.numPages);
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
    return true;
  } catch (e) {
    cleanup();
    throw e;
  }
}
