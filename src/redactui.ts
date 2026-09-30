// Redact tool: drag to mark areas; marks live in PDF coordinates and are
// redrawn whenever pdf.js re-renders a page (zoom, rotation, scrolling).
import type { RedactionMark, Rect } from "./redact";

interface Ctx { container: HTMLElement; viewer: any; eventBus: any; active: () => boolean; onChange: (n: number) => void }

export function setupRedact(ctx: Ctx) {
  let marks: RedactionMark[] = [];

  const viewportRect = (view: any, r: Rect) => {
    const [x1, y1] = view.viewport.convertToViewportPoint(r[0], r[1]);
    const [x2, y2] = view.viewport.convertToViewportPoint(r[0] + r[2], r[1] + r[3]);
    return { left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
  };

  const render = () => {
    ctx.container.querySelectorAll(".redact-mark").forEach((n) => n.remove());
    marks.forEach((m, i) => {
      const view = ctx.viewer.getPageView(m.pageIndex);
      if (!view?.div || !view.viewport) return;
      const r = viewportRect(view, m.rect);
      const div = document.createElement("div");
      div.className = "redact-mark";
      Object.assign(div.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      const x = document.createElement("button");
      x.type = "button";
      x.className = "redact-remove";
      x.title = "Remove this mark";
      x.ariaLabel = "Remove redaction mark";
      x.textContent = "×";
      x.addEventListener("pointerdown", (e) => e.stopPropagation());
      x.onclick = (e) => { e.stopPropagation(); marks.splice(i, 1); changed(); };
      div.append(x);
      view.div.append(div);
    });
  };
  const changed = () => { render(); ctx.onChange(marks.length); };
  ctx.eventBus.on("pagerendered", render);
  ctx.eventBus.on("scalechanging", () => setTimeout(render, 0));

  ctx.container.addEventListener("pointerdown", (e) => {
    if (!ctx.active() || e.button !== 0) return;
    const pageEl = (e.target as HTMLElement).closest(".page") as HTMLElement | null;
    if (!pageEl || (e.target as HTMLElement).closest(".redact-mark")) return;
    e.preventDefault();
    e.stopPropagation();
    const idx = +pageEl.dataset.pageNumber! - 1;
    const view = ctx.viewer.getPageView(idx);
    const box = pageEl.getBoundingClientRect();
    const ox = box.left + pageEl.clientLeft, oy = box.top + pageEl.clientTop;
    const sx = e.clientX - ox, sy = e.clientY - oy;
    const ghost = document.createElement("div");
    ghost.className = "redact-mark drawing";
    pageEl.append(ghost);
    const move = (ev: PointerEvent) => {
      const cx = Math.max(0, Math.min(pageEl.clientWidth, ev.clientX - ox)), cy = Math.max(0, Math.min(pageEl.clientHeight, ev.clientY - oy));
      Object.assign(ghost.style, { left: `${Math.min(sx, cx)}px`, top: `${Math.min(sy, cy)}px`, width: `${Math.abs(cx - sx)}px`, height: `${Math.abs(cy - sy)}px` });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      ghost.remove();
      if (ev.type === "pointercancel") return;
      const cx = Math.max(0, Math.min(pageEl.clientWidth, ev.clientX - ox)), cy = Math.max(0, Math.min(pageEl.clientHeight, ev.clientY - oy));
      if (Math.abs(cx - sx) < 4 || Math.abs(cy - sy) < 4) return;
      const [px1, py1] = view.viewport.convertToPdfPoint(sx, sy);
      const [px2, py2] = view.viewport.convertToPdfPoint(cx, cy);
      marks.push({ pageIndex: idx, rect: [Math.min(px1, px2), Math.min(py1, py2), Math.abs(px2 - px1), Math.abs(py2 - py1)] });
      changed();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }, true);

  return {
    marks: () => marks.slice(),
    clear() { marks = []; changed(); },
    add(more: RedactionMark[]) { marks.push(...more); changed(); },
  };
}
