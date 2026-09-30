// Tiny DOM helpers and accessible dialogs built on <dialog>.
export const $ = (sel: string) => {
  const n = document.querySelector(sel);
  if (!n) throw new Error(`Missing element ${sel}`);
  return n as HTMLElement;
};

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, any> = {}, children: (Node | string)[] = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("aria") && k.length > 4) n.setAttribute("aria-" + k.slice(4).toLowerCase(), String(v));
    else if (k === "role") n.setAttribute("role", v);
    else (n as any)[k] = v;
  }
  n.append(...children);
  return n;
}

export function toast(message: string, kind: "info" | "error" = "info") {
  // Don't stack identical messages (e.g. several events reporting the same problem).
  if ([...document.querySelectorAll("#toasts .toast:not(.out)")].some((t) => t.textContent === message)) return;
  const t = el("div", { className: `toast ${kind}`, role: kind === "error" ? "alert" : "status", textContent: message });
  document.getElementById("toasts")!.append(t);
  const ttl = kind === "error" ? 7000 : 3000;
  t.onclick = () => t.remove();
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, ttl);
}

interface DialogButton<T> { label: string; value: T; primary?: boolean; danger?: boolean }
interface DialogOpts<T> { title: string; message?: string; body?: HTMLElement; buttons: DialogButton<T>[]; wide?: boolean }

export function showDialog<T>(opts: DialogOpts<T>): Promise<T | null> {
  return new Promise((resolve) => {
    const d = el("dialog", { className: "ll-dialog" + (opts.wide ? " wide" : "") }) as HTMLDialogElement;
    const form = el("form", { method: "dialog" });
    form.append(el("h2", { textContent: opts.title }));
    if (opts.message) form.append(el("p", { textContent: opts.message }));
    if (opts.body) form.append(opts.body);
    const row = el("div", { className: "dialog-buttons" });
    let result: T | null = null;
    opts.buttons.forEach((b) => {
      const bt = el("button", { type: b.primary ? "submit" : "button", className: b.primary ? (b.danger ? "primary-btn danger" : "primary-btn") : "text-btn", textContent: b.label }) as HTMLButtonElement;
      bt.onclick = (e) => {
        if (b.primary) return; // handled by submit
        e.preventDefault();
        result = b.value;
        d.close();
      };
      if (b.primary) (form as any)._primary = b.value;
      row.append(bt);
    });
    form.append(row);
    form.addEventListener("submit", (e) => {
      const check = (form as any)._validate as (() => boolean) | undefined;
      if (check && !check()) { e.preventDefault(); return; }
      result = (form as any)._primary;
    });
    d.append(form);
    d.addEventListener("close", () => { d.remove(); resolve(result); });
    (d as any)._form = form;
    document.body.append(d);
    d.showModal();
    const focus = form.querySelector("input") ?? form.querySelector("button[type=submit]");
    (focus as HTMLElement | null)?.focus();
  });
}

export async function confirmDialog(o: { title: string; message: string; okLabel?: string; danger?: boolean }): Promise<boolean> {
  const r = await showDialog({ title: o.title, message: o.message, buttons: [{ label: "Cancel", value: false }, { label: o.okLabel ?? "OK", value: true, primary: true, danger: o.danger }] });
  return r === true;
}

export async function promptDialog(o: { title: string; message: string; value?: string; inputType?: string; okLabel?: string; validate?: (v: string) => string | null }): Promise<string | null> {
  // Named after the dialog (“Extract pages”, “Password”…); errors are announced and tied to the field.
  const errId = `err-${Math.random().toString(36).slice(2)}`;
  const input = el("input", { type: o.inputType ?? "text", value: o.value ?? "", className: "text-input", autocomplete: o.inputType === "password" ? "current-password" : "off", ariaLabel: o.title }) as HTMLInputElement;
  input.setAttribute("aria-describedby", errId);
  const err = el("p", { className: "field-error", role: "alert", id: errId });
  const body = el("div", {}, [input, err]);
  const p = showDialog({ title: o.title, message: o.message, body, buttons: [{ label: "Cancel", value: false }, { label: o.okLabel ?? "OK", value: true, primary: true }] });
  const form = input.closest("form") as any;
  if (form) form._validate = () => {
    const m = o.validate?.(input.value) ?? null;
    err.textContent = m ?? "";
    return !m;
  };
  input.addEventListener("input", () => (err.textContent = ""));
  const ok = await p;
  return ok ? input.value : null;
}

export interface MenuItem { label: string; hint?: string; run: () => void; disabled?: boolean; danger?: boolean }
let openPopup: (() => void) | null = null;
/** A small menu anchored to a button; arrow keys move, Esc closes and returns focus. */
export function popupMenu(anchor: HTMLElement, items: MenuItem[]) {
  const wasOpen = anchor.ariaExpanded === "true";
  openPopup?.();
  if (wasOpen) return; // a second click on the button closes it
  const menu = el("div", { className: "menu popup-menu", role: "menu" });
  for (const it of items) {
    const b = el("button", { type: "button", role: "menuitem", disabled: !!it.disabled, className: it.danger ? "danger" : "" }, [
      el("span", { textContent: it.label }), ...(it.hint ? [el("kbd", { textContent: it.hint })] : []),
    ]) as HTMLButtonElement;
    b.onclick = () => { close(false); it.run(); };
    menu.append(b);
  }
  const close = (refocus: boolean) => {
    menu.remove(); anchor.ariaExpanded = "false"; openPopup = null;
    document.removeEventListener("pointerdown", outside, true);
    if (refocus) anchor.focus();
  };
  const outside = (e: Event) => { if (!menu.contains(e.target as Node) && !anchor.contains(e.target as Node)) close(false); };
  menu.addEventListener("keydown", (e) => {
    const bs = [...menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const i = bs.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") { e.preventDefault(); bs[(i + 1) % bs.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length].focus(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === "Tab") close(false);
  });
  document.body.append(menu);
  const r = anchor.getBoundingClientRect(), m = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(r.right - m.width, innerWidth - m.width - 8))}px`;
  menu.style.top = `${r.bottom + m.height + 4 > innerHeight ? Math.max(8, r.top - m.height - 4) : r.bottom + 4}px`;
  anchor.ariaExpanded = "true";
  document.addEventListener("pointerdown", outside, true);
  openPopup = () => close(false);
  menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
}
