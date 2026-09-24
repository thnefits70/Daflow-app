"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  ChevronDown,
  DollarSign,
  Italic,
  Lock,
  LogOut,
  PaintBucket,
  Percent,
  Plus,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Underline,
  Undo2,
} from "lucide-react";
import { type Cell, type CellStyle, type SheetSide, SHEET_MAX_COLS, SHEET_MAX_ROWS, cellName, colName, formatValue, imageUrlOf, makeEvaluator } from "@/lib/supplierSheet";

// Confirmado 2026-09-24, pedido explícito del usuario: el enlace de la hoja
// de CHEN se ve y se usa como una hoja de Excel/Google Sheets en línea — un
// solo enlace para todo su equipo, cada uno escribe lo que quiera. Todo se
// guarda solo (celda por celda) y cada pocos segundos se trae lo que
// escribieron los demás.

// rowKeys (solo pestañas automáticas): fila → pedido/pago al que pertenece; lo
// que CHEN escribe se guarda amarrado a ese pedido, nunca al número de fila.
type Tab = { id: string; name: string; colWidths: Record<string, number>; rowHeights: Record<string, number>; rowKeys: Record<string, string>; autoCols: number[]; locked: boolean; createdBySide: SheetSide | null; cells: Record<string, Cell> };
type ServerTab = {
  id: string;
  name: string;
  colWidths: Record<string, number>;
  rowHeights?: Record<string, number>;
  rowKeys?: Record<string, string>;
  autoCols?: number[];
  locked?: boolean;
  createdBySide?: SheetSide | null;
  cells: { r: number; c: number; v: string; s: CellStyle | null; a?: SheetSide | null; e?: string | null }[];
};
type Op =
  | { t: "set"; tabId: string; r: number; c: number; v: string; s: CellStyle | null; k?: string }
  | { t: "addTab"; name: string }
  | { t: "renameTab"; tabId: string; name: string }
  | { t: "deleteTab"; tabId: string }
  | { t: "colWidth"; tabId: string; c: number; w: number };
type Change = { tabId: string; r: number; c: number; k?: string; before: Cell; after: Cell };
type Pos = { r: number; c: number };

const DEFAULT_COL_W = 100;
const ROW_H = 21;
const HEADER_W = 46;
const EMPTY: Cell = { v: "", s: null };
const FONT_SIZES = [8, 9, 10, 11, 12, 14, 18, 24, 36];

function fromServer(tabs: ServerTab[]): Tab[] {
  return tabs.map((t) => {
    const cells: Record<string, Cell> = {};
    for (const c of t.cells) cells[`${c.r}:${c.c}`] = { v: c.v, s: c.s, a: c.a ?? null, e: c.e ?? null };
    return { id: t.id, name: t.name, colWidths: t.colWidths ?? {}, rowHeights: t.rowHeights ?? {}, rowKeys: t.rowKeys ?? {}, autoCols: t.autoCols ?? [], locked: !!t.locked, createdBySide: t.createdBySide ?? null, cells };
  });
}

function cleanStyle(s: CellStyle | null): CellStyle | null {
  if (!s) return null;
  const out: CellStyle = {};
  for (const [k, v] of Object.entries(s)) if (v !== undefined && v !== false && v !== "") (out as Record<string, unknown>)[k] = v;
  return Object.keys(out).length ? out : null;
}

// Confirmado 2026-09-24: solo entra un correo de la lista del admin (ver
// supplierSheetAccess.ts). canWrite=false → solo ve; las hojas con candado
// (las llena DAFLOW sola) nunca se editan desde acá — la API también lo frena.
// Confirmado 2026-09-24 (antifraude): una celda escrita por el otro lado
// (side) no se puede cambiar — la API lo rechaza igual; acá solo se avisa.
export function SupplierSheet({ token, email, canWrite, side }: { token: string; email: string; canWrite: boolean; side: SheetSide }) {
  const api = `/api/proveedor-ledger/${token}/hoja`;
  const [tabs, setTabs] = useState<Tab[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sel, setSel] = useState<Pos>({ r: 0, c: 0 });
  const [anchor, setAnchor] = useState<Pos>({ r: 0, c: 0 });
  const [editing, setEditing] = useState<{ r: number; c: number; value: string; source: "cell" | "bar" } | null>(null);
  const [status, setStatus] = useState<"saved" | "saving" | "offline">("saved");
  const [loadErr, setLoadErr] = useState(false);
  const [extraRows, setExtraRows] = useState(0);
  const [tabMenu, setTabMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [notice, setNotice] = useState("");
  const otherSideMsg = "Esa celda la escribió el otro equipo — no se puede cambiar ni borrar.";
  // Confirmado 2026-09-24: el aviso de lo automático sale SOLO cuando alguien
  // intenta cambiar una de esas celdas (la API también lo frena).
  const autoMsg = "Esa información se carga automáticamente — no se puede cambiar ni borrar.";
  const noRowMsg = "En esta hoja se escribe al lado de un pedido o de un pago. Para notas generales usa la hoja libre.";
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 5000);
  }, []);

  const tabsRef = useRef<Tab[] | null>(null);
  useLayoutEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);
  const queue = useRef<Op[]>([]);
  const pendingKeys = useRef<Map<string, number>>(new Map());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushing = useRef(false);
  const undoStack = useRef<Change[][]>([]);
  const redoStack = useRef<Change[][]>([]);
  const gridRef = useRef<HTMLDivElement>(null);
  // Campo invisible que siempre tiene el foco cuando no se está editando:
  // recibe lo que se escribe (también el teclado del celular y la escritura
  // en chino con IME, que no llegan como teclas sueltas) y abre la celda.
  const keyInputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const editInputRef = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);
  const resizing = useRef<{ c: number; startX: number; startW: number } | null>(null);
  const [liveWidth, setLiveWidth] = useState<{ c: number; w: number } | null>(null);
  const editingRef = useRef(editing);
  useLayoutEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  const tab = tabs?.find((t) => t.id === activeId) ?? tabs?.[0] ?? null;
  const readOnly = !canWrite || !!tab?.locked;
  const readOnlyRef = useRef(readOnly);
  useLayoutEffect(() => {
    readOnlyRef.current = readOnly;
  }, [readOnly]);

  // ---------- Carga y sincronización ----------

  const applyServer = useCallback((server: ServerTab[]) => {
    const incoming = fromServer(server);
    const prev = tabsRef.current;
    if (prev) {
      // Lo que esta persona cambió y todavía no terminó de guardarse (o está
      // escribiendo ahora mismo) no se pisa con lo que viene del servidor.
      for (const t of incoming) {
        const old = prev.find((p) => p.id === t.id);
        if (!old) continue;
        for (const key of pendingKeys.current.keys()) {
          const [tabId, r, c] = key.split(":");
          if (tabId !== t.id) continue;
          const k = `${r}:${c}`;
          if (old.cells[k]) t.cells[k] = old.cells[k];
          else delete t.cells[k];
        }
      }
    }
    setTabs(incoming);
    // Al abrir, se muestra la pestaña de pedidos del mes más reciente.
    const latestMonth = [...incoming].reverse().find((t) => t.id.startsWith("auto-pedidos-"));
    setActiveId((cur) => (cur && incoming.some((t) => t.id === cur) ? cur : (latestMonth ?? incoming[0])?.id ?? null));
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(api, { cache: "no-store" });
      if (res.status === 401) { window.location.reload(); return null; }
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { tabs: ServerTab[] };
      applyServer(data.tabs);
      setLoadErr(false);
      return data.tabs;
    } catch {
      if (!tabsRef.current) setLoadErr(true);
      return null;
    }
  }, [api, applyServer]);

  const flushRef = useRef<() => Promise<string[] | null>>(async () => null);
  const flush = useCallback(async (): Promise<string[] | null> => {
    if (flushing.current || queue.current.length === 0) return null;
    flushing.current = true;
    const batch = queue.current.splice(0, queue.current.length);
    setStatus("saving");
    try {
      const res = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ops: batch }) });
      if (res.status === 401) { window.location.reload(); return null; }
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { createdTabIds?: string[]; rejected?: string[]; rejectedMessage?: string };
      for (const op of batch) {
        if (op.t !== "set") continue;
        const key = `${op.tabId}:${op.r}:${op.c}`;
        const n = (pendingKeys.current.get(key) ?? 1) - 1;
        if (n <= 0) pendingKeys.current.delete(key);
        else pendingKeys.current.set(key, n);
      }
      flushing.current = false;
      if (data.rejected?.length) {
        showNotice(data.rejectedMessage ?? "Ese cambio no se permite.");
        void load();
      }
      if (queue.current.length) void flushRef.current();
      else setStatus("saved");
      return data.createdTabIds ?? [];
    } catch {
      queue.current.unshift(...batch);
      flushing.current = false;
      setStatus("offline");
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(() => void flushRef.current(), 3000);
      return null;
    }
  }, [api, load, showNotice]);
  useLayoutEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const enqueue = useCallback(
    (ops: Op[]) => {
      for (const op of ops) {
        if (op.t === "set") {
          const key = `${op.tabId}:${op.r}:${op.c}`;
          pendingKeys.current.set(key, (pendingKeys.current.get(key) ?? 0) + 1);
        }
      }
      queue.current.push(...ops);
      setStatus("saving");
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(() => void flush(), 400);
    },
    [flush],
  );

  useEffect(() => {
    let alive = true;
    const first = setTimeout(() => void load(), 0);
    const iv = setInterval(() => {
      if (!alive || document.hidden || flushing.current || queue.current.length) return;
      void load();
    }, 4000);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (queue.current.length || flushing.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(iv);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [load]);

  // ---------- Cambios de celdas ----------

  const getCell = useCallback((t: Tab | null, r: number, c: number): Cell => t?.cells[`${r}:${c}`] ?? EMPTY, []);

  const applyChanges = useCallback(
    (changes: Change[], which: "after" | "before") => {
      if (!changes.length) return;
      setTabs((prev) =>
        prev
          ? prev.map((t) => {
              const mine = changes.filter((ch) => ch.tabId === t.id);
              if (!mine.length) return t;
              const cells = { ...t.cells };
              for (const ch of mine) {
                const cell = ch[which];
                const k = `${ch.r}:${ch.c}`;
                if (cell.v === "" && !cell.s) delete cells[k];
                else cells[k] = cell;
              }
              return { ...t, cells };
            })
          : prev,
      );
      enqueue(changes.map((ch) => ({ t: "set", tabId: ch.tabId, r: ch.r, c: ch.c, v: ch[which].v, s: ch[which].s, k: ch.k })));
    },
    [enqueue],
  );

  const commit = useCallback(
    (cells: { r: number; c: number; next: (old: Cell) => Cell }[]) => {
      const t = tabsRef.current?.find((x) => x.id === (activeId ?? tabsRef.current?.[0]?.id));
      if (!t || t.locked || readOnlyRef.current) return;
      const changes: Change[] = [];
      let blocked = 0;
      let blockedAuto = 0;
      let blockedNoRow = 0;
      const isAutoTab = t.autoCols.length > 0;
      for (const { r, c, next } of cells) {
        if (r < 0 || c < 0 || r >= SHEET_MAX_ROWS || c >= SHEET_MAX_COLS) continue;
        if (t.autoCols.includes(c)) {
          blockedAuto++;
          continue;
        }
        const k = isAutoTab ? t.rowKeys[r] : undefined;
        if (isAutoTab && !k) {
          blockedNoRow++;
          continue;
        }
        const before = getCell(t, r, c);
        if (before.a && before.a !== side) {
          blocked++;
          continue;
        }
        const raw = next(before);
        const after: Cell = { v: raw.v, s: cleanStyle(raw.s), a: side, e: email };
        if (before.v === after.v && JSON.stringify(before.s) === JSON.stringify(after.s)) continue;
        changes.push({ tabId: t.id, r, c, k, before, after });
      }
      if (blockedAuto) showNotice(autoMsg);
      else if (blockedNoRow) showNotice(noRowMsg);
      else if (blocked) showNotice(otherSideMsg);
      if (!changes.length) return;
      undoStack.current.push(changes);
      if (undoStack.current.length > 200) undoStack.current.shift();
      redoStack.current = [];
      applyChanges(changes, "after");
    },
    [activeId, applyChanges, getCell, side, email, showNotice, otherSideMsg, autoMsg, noRowMsg],
  );

  function undo() {
    const changes = undoStack.current.pop();
    if (!changes) return;
    redoStack.current.push(changes);
    applyChanges(changes, "before");
  }
  function redo() {
    const changes = redoStack.current.pop();
    if (!changes) return;
    undoStack.current.push(changes);
    applyChanges(changes, "after");
  }

  // ---------- Selección ----------

  const range = useMemo(
    () => ({ r1: Math.min(sel.r, anchor.r), r2: Math.max(sel.r, anchor.r), c1: Math.min(sel.c, anchor.c), c2: Math.max(sel.c, anchor.c) }),
    [sel, anchor],
  );

  function rangeCells() {
    const out: Pos[] = [];
    for (let r = range.r1; r <= range.r2; r++) for (let c = range.c1; c <= range.c2; c++) out.push({ r, c });
    return out;
  }

  const usedRows = useMemo(() => {
    let max = 0;
    if (tab) for (const k of Object.keys(tab.cells)) max = Math.max(max, Number(k.split(":")[0]) + 1);
    return max;
  }, [tab]);
  const rowCount = Math.min(SHEET_MAX_ROWS, Math.max(100, usedRows + 20, sel.r + 20) + extraRows);

  function select(p: Pos, extend = false) {
    const r = Math.max(0, Math.min(SHEET_MAX_ROWS - 1, p.r));
    const c = Math.max(0, Math.min(SHEET_MAX_COLS - 1, p.c));
    setSel({ r, c });
    if (!extend) setAnchor({ r, c });
  }

  useEffect(() => {
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-cell="${sel.r}:${sel.c}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [sel]);

  function focusGrid() {
    keyInputRef.current?.focus({ preventScroll: true });
  }

  const loaded = !!tabs;
  useEffect(() => {
    if (loaded && window.matchMedia("(pointer: fine)").matches) keyInputRef.current?.focus({ preventScroll: true });
  }, [loaded]);

  // ---------- Edición ----------

  function startEdit(initial?: string, source: "cell" | "bar" = "cell") {
    if (readOnly) return;
    if (tab?.autoCols.length && !tab.autoCols.includes(sel.c) && !tab.rowKeys[sel.r]) {
      showNotice(noRowMsg);
      return;
    }
    if (tab?.autoCols.includes(sel.c)) {
      // Doble clic sobre una foto: la amplía (GlobalImageZoom), sin aviso.
      if (!imageUrlOf(getCell(tab, sel.r, sel.c).v)) showNotice(autoMsg);
      return;
    }
    const cur = getCell(tab, sel.r, sel.c);
    if (cur.a && cur.a !== side) {
      showNotice(otherSideMsg);
      return;
    }
    setEditing({ r: sel.r, c: sel.c, value: initial ?? getCell(tab, sel.r, sel.c).v, source });
  }

  function finishEdit(move?: Pos) {
    const e = editingRef.current;
    if (!e) return;
    commit([{ r: e.r, c: e.c, next: (old) => ({ ...old, v: e.value }) }]);
    setEditing(null);
    if (move) select({ r: e.r + move.r, c: e.c + move.c });
    focusGrid();
  }

  function cancelEdit() {
    setEditing(null);
    focusGrid();
  }

  useEffect(() => {
    if (editing?.source === "cell") {
      const el = editInputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }
    // Solo al empezar a editar otra celda, no en cada tecla.
  }, [editing?.r, editing?.c, editing?.source]);

  // ---------- Formato ----------

  const selStyle = getCell(tab, sel.r, sel.c).s ?? {};

  function setStyle(patch: (s: CellStyle) => CellStyle) {
    commit(rangeCells().map(({ r, c }) => ({ r, c, next: (old) => ({ v: old.v, s: patch({ ...(old.s ?? {}) }) }) })));
  }
  function toggle(key: "b" | "i" | "u" | "st") {
    const on = !selStyle[key];
    setStyle((s) => ({ ...s, [key]: on }));
  }

  // ---------- Teclado y portapapeles ----------

  function onGridKey(e: React.KeyboardEvent) {
    if (editing) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (mod && k.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
    if (mod && k.toLowerCase() === "b") { e.preventDefault(); toggle("b"); return; }
    if (mod && k.toLowerCase() === "i") { e.preventDefault(); toggle("i"); return; }
    if (mod && k.toLowerCase() === "u") { e.preventDefault(); toggle("u"); return; }
    if (mod && k.toLowerCase() === "a") { e.preventDefault(); setAnchor({ r: 0, c: 0 }); setSel({ r: rowCount - 1, c: SHEET_MAX_COLS - 1 }); return; }
    if (mod) return;
    const moves: Record<string, Pos> = { ArrowUp: { r: -1, c: 0 }, ArrowDown: { r: 1, c: 0 }, ArrowLeft: { r: 0, c: -1 }, ArrowRight: { r: 0, c: 1 } };
    if (moves[k]) {
      e.preventDefault();
      select({ r: sel.r + moves[k].r, c: sel.c + moves[k].c }, e.shiftKey);
      return;
    }
    if (k === "Enter") { e.preventDefault(); if (e.shiftKey) select({ r: sel.r - 1, c: sel.c }); else startEdit(); return; }
    if (k === "Tab") { e.preventDefault(); select({ r: sel.r, c: sel.c + (e.shiftKey ? -1 : 1) }); return; }
    if (k === "F2") { e.preventDefault(); startEdit(); return; }
    if (k === "Delete" || k === "Backspace") {
      e.preventDefault();
      commit(rangeCells().map(({ r, c }) => ({ r, c, next: (old) => ({ ...old, v: "" }) })));
      return;
    }
    // Letras y números no se frenan acá: llegan al campo invisible y
    // onKeyInput abre la celda con lo escrito.
  }

  function onKeyInput(e: React.FormEvent<HTMLInputElement>) {
    if (composing.current || editing) return;
    const text = e.currentTarget.value;
    e.currentTarget.value = "";
    if (text) startEdit(text);
  }

  function onEditKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); finishEdit({ r: e.shiftKey ? -1 : 1, c: 0 }); }
    else if (e.key === "Tab") { e.preventDefault(); finishEdit({ r: 0, c: e.shiftKey ? -1 : 1 }); }
    else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
    else if (editing?.source === "cell" && editing.value !== "" && !editing.value.startsWith("=") && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      finishEdit({ r: e.key === "ArrowUp" ? -1 : 1, c: 0 });
    }
  }

  function onCopy(e: React.ClipboardEvent, cut = false) {
    if (editing) return;
    e.preventDefault();
    const lines: string[] = [];
    for (let r = range.r1; r <= range.r2; r++) {
      const row: string[] = [];
      for (let c = range.c1; c <= range.c2; c++) row.push(getCell(tab, r, c).v);
      lines.push(row.join("\t"));
    }
    e.clipboardData.setData("text/plain", lines.join("\n"));
    if (cut) commit(rangeCells().map(({ r, c }) => ({ r, c, next: (old) => ({ ...old, v: "" }) })));
  }

  // Pegar desde Excel/Sheets/WhatsApp: filas separadas por salto de línea,
  // columnas por tabulación — igual que Excel.
  function onPaste(e: React.ClipboardEvent) {
    if (editing) return;
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain").replace(/\r/g, "").replace(/\n$/, "");
    if (!text) return;
    const rows = text.split("\n").map((l) => l.split("\t"));
    const cells: { r: number; c: number; next: (old: Cell) => Cell }[] = [];
    rows.forEach((row, i) => row.forEach((v, j) => cells.push({ r: sel.r + i, c: sel.c + j, next: (old) => ({ ...old, v }) })));
    commit(cells);
    setAnchor({ r: sel.r, c: sel.c });
    setSel({ r: Math.min(SHEET_MAX_ROWS - 1, sel.r + rows.length - 1), c: Math.min(SHEET_MAX_COLS - 1, sel.c + Math.max(...rows.map((r) => r.length)) - 1) });
  }

  // ---------- Columnas ----------

  function colW(c: number) {
    if (liveWidth?.c === c) return liveWidth.w;
    return tab?.colWidths[String(c)] ?? DEFAULT_COL_W;
  }

  useEffect(() => {
    function move(e: PointerEvent) {
      const rz = resizing.current;
      if (!rz) return;
      setLiveWidth({ c: rz.c, w: Math.max(30, Math.min(800, Math.round(rz.startW + e.clientX - rz.startX))) });
    }
    function up() {
      dragging.current = false;
      const rz = resizing.current;
      if (!rz) return;
      resizing.current = null;
      setLiveWidth((lw) => {
        if (lw && tabsRef.current) {
          const tabId = activeId ?? tabsRef.current[0]?.id;
          if (tabId) {
            setTabs((prev) => prev?.map((t) => (t.id === tabId ? { ...t, colWidths: { ...t.colWidths, [String(lw.c)]: lw.w } } : t)) ?? prev);
            enqueue([{ t: "colWidth", tabId, c: lw.c, w: lw.w }]);
          }
        }
        return null;
      });
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [activeId, enqueue]);

  // ---------- Pestañas ----------

  async function addTab() {
    const names = new Set(tabs?.map((t) => t.name));
    let n = (tabs?.length ?? 0) + 1;
    while (names.has(`Hoja ${n}`)) n++;
    enqueue([{ t: "addTab", name: `Hoja ${n}` }]);
    if (flushTimer.current) clearTimeout(flushTimer.current);
    const created = await flush();
    await load();
    if (created?.[0]) {
      setActiveId(created[0]);
      select({ r: 0, c: 0 });
    }
  }

  function renameTab(id: string, name: string) {
    const clean = name.trim().slice(0, 60);
    setRenaming(null);
    if (!clean) return;
    setTabs((prev) => prev?.map((t) => (t.id === id ? { ...t, name: clean } : t)) ?? prev);
    enqueue([{ t: "renameTab", tabId: id, name: clean }]);
  }

  function deleteTab(id: string) {
    setTabMenu(null);
    if (!tabs || tabs.filter((x) => !x.locked).length <= 1) return;
    const t = tabs.find((x) => x.id === id);
    if (!window.confirm(`¿Eliminar la hoja "${t?.name}"? Se borra todo lo que tiene escrito, para todos.`)) return;
    const rest = tabs.filter((x) => x.id !== id);
    setTabs(rest);
    if (activeId === id) setActiveId(rest[0].id);
    undoStack.current = undoStack.current.filter((b) => b.every((ch) => ch.tabId !== id));
    redoStack.current = redoStack.current.filter((b) => b.every((ch) => ch.tabId !== id));
    enqueue([{ t: "deleteTab", tabId: id }]);
  }

  // ---------- Render ----------

  const evalCell = useMemo(() => makeEvaluator(tab?.cells ?? {}), [tab]);

  if (loadErr) return <div className="p-6 text-sm text-neutral-600">No se pudo abrir la hoja. Revisen su conexión y vuelvan a cargar la página.</div>;
  if (!tabs || !tab) return <div className="p-6 text-sm text-neutral-500">Cargando hoja…</div>;

  const cols = Array.from({ length: SHEET_MAX_COLS }, (_, c) => c);
  const rows = Array.from({ length: rowCount }, (_, r) => r);
  const selCell = getCell(tab, sel.r, sel.c);
  const selRaw = selCell.v;
  const barValue = editing && editing.r === sel.r && editing.c === sel.c ? editing.value : selRaw;
  const rangeLabel = range.r1 === range.r2 && range.c1 === range.c2 ? cellName(sel.r, sel.c) : `${cellName(range.r1, range.c1)}:${cellName(range.r2, range.c2)}`;

  const tb = "flex h-7 min-w-7 items-center justify-center rounded px-1 text-neutral-700 hover:bg-neutral-200 disabled:opacity-40";
  const tbOn = "bg-[#d3e3fd] text-[#0b57d0] hover:bg-[#c2d7fc]";

  return (
    <div className="flex h-dvh flex-col bg-white text-neutral-900 select-none [color-scheme:light]" onPointerDown={() => tabMenu && setTabMenu(null)}>
      {/* Barra de título */}
      <div className="flex items-center gap-3 border-b border-neutral-200 px-3 py-2 sm:px-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-[#0f9d58] text-white">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
            <path d="M5 3h10l4 4v14H5V3zm2 8v2h4v-2H7zm6 0v2h4v-2h-4zm-6 4v2h4v-2H7zm6 0v2h4v-2h-4z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] leading-tight">Hoja de cálculo del equipo</div>
          <div className="truncate text-[11.5px] text-neutral-500">
            {canWrite ? "Todo lo que escriban se guarda solo y lo ve todo el equipo autorizado." : "Tu correo tiene permiso solo para ver."}
          </div>
        </div>
        <div className="shrink-0 text-[12px] text-neutral-500">
          {status === "saving" ? "Guardando…" : status === "offline" ? <span className="text-red-600">Sin conexión — reintentando…</span> : "Todo guardado"}
        </div>
        <div className="flex shrink-0 items-center gap-2 border-l border-neutral-200 pl-3 text-[12px] text-neutral-600">
          <span className="hidden max-w-[200px] truncate sm:inline" title={email}>{email}</span>
          <button
            type="button"
            className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-neutral-100"
            title="Salir"
            onClick={async () => {
              await fetch(`/api/proveedor-ledger/${token}/hoja/logout`, { method: "POST" }).catch(() => {});
              window.location.reload();
            }}
          >
            <LogOut size={14} /> <span className="hidden sm:inline">Salir</span>
          </button>
        </div>
      </div>

      {tab.locked && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[12.5px] text-amber-900">
          <Lock size={13} className="shrink-0" /> Esta hoja se llena sola con la información de la operación. Pueden verla y copiarla, pero no modificarla.
        </div>
      )}

      {/* Barra de herramientas */}
      <div className={`flex items-center gap-0.5 overflow-x-auto border-b border-neutral-200 bg-[#f9fbfd] px-2 py-1 text-[13px] ${readOnly ? "pointer-events-none opacity-40" : ""}`} onPointerDown={(e) => e.preventDefault()}>
        <button type="button" className={tb} title="Deshacer (Ctrl+Z)" onClick={undo}><Undo2 size={16} /></button>
        <button type="button" className={tb} title="Rehacer (Ctrl+Y)" onClick={redo}><Redo2 size={16} /></button>
        <span className="mx-1 h-5 w-px shrink-0 bg-neutral-300" />
        <button type="button" className={`${tb} ${selStyle.fmt === "currency" ? tbOn : ""}`} title="Formato de moneda" onClick={() => setStyle((s) => ({ ...s, fmt: s.fmt === "currency" ? undefined : "currency" }))}><DollarSign size={15} /></button>
        <button type="button" className={`${tb} ${selStyle.fmt === "percent" ? tbOn : ""}`} title="Formato de porcentaje" onClick={() => setStyle((s) => ({ ...s, fmt: s.fmt === "percent" ? undefined : "percent" }))}><Percent size={15} /></button>
        <button type="button" className={`${tb} text-[12px] font-medium`} title="Menos decimales" onClick={() => setStyle((s) => ({ ...s, dp: Math.max(0, (s.dp ?? (s.fmt === "percent" ? 0 : 2)) - 1) }))}>.0</button>
        <button type="button" className={`${tb} text-[12px] font-medium`} title="Más decimales" onClick={() => setStyle((s) => ({ ...s, dp: Math.min(10, (s.dp ?? (s.fmt === "percent" ? 0 : s.fmt ? 2 : 0)) + 1) }))}>.00</button>
        <span className="mx-1 h-5 w-px shrink-0 bg-neutral-300" />
        <select
          className="h-7 shrink-0 rounded border border-transparent bg-white px-1 text-[13px] text-neutral-800 hover:bg-neutral-200"
          title="Tamaño de letra"
          value={selStyle.fs ?? 10}
          onChange={(e) => { const fs = Number(e.target.value); setStyle((s) => ({ ...s, fs: fs === 10 ? undefined : fs })); focusGrid(); }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {FONT_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <span className="mx-1 h-5 w-px shrink-0 bg-neutral-300" />
        <button type="button" className={`${tb} ${selStyle.b ? tbOn : ""}`} title="Negrita (Ctrl+B)" onClick={() => toggle("b")}><Bold size={15} /></button>
        <button type="button" className={`${tb} ${selStyle.i ? tbOn : ""}`} title="Cursiva (Ctrl+I)" onClick={() => toggle("i")}><Italic size={15} /></button>
        <button type="button" className={`${tb} ${selStyle.st ? tbOn : ""}`} title="Tachado" onClick={() => toggle("st")}><Strikethrough size={15} /></button>
        <button type="button" className={`${tb} ${selStyle.u ? tbOn : ""}`} title="Subrayado (Ctrl+U)" onClick={() => toggle("u")}><Underline size={15} /></button>
        <label className={`${tb} relative cursor-pointer flex-col gap-0`} title="Color de letra" onPointerDown={(e) => e.stopPropagation()}>
          <Baseline size={15} />
          <span className="h-[3px] w-4" style={{ background: selStyle.fc ?? "#000" }} />
          <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={selStyle.fc ?? "#000000"} onChange={(e) => { const fc = e.target.value; setStyle((s) => ({ ...s, fc })); }} />
        </label>
        <label className={`${tb} relative cursor-pointer flex-col gap-0`} title="Color de relleno" onPointerDown={(e) => e.stopPropagation()}>
          <PaintBucket size={15} />
          <span className="h-[3px] w-4 border border-neutral-300" style={{ background: selStyle.bg ?? "transparent" }} />
          <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={selStyle.bg ?? "#ffffff"} onChange={(e) => { const bg = e.target.value; setStyle((s) => ({ ...s, bg: bg.toLowerCase() === "#ffffff" ? undefined : bg })); }} />
        </label>
        <span className="mx-1 h-5 w-px shrink-0 bg-neutral-300" />
        <button type="button" className={`${tb} ${selStyle.al === "left" ? tbOn : ""}`} title="Alinear a la izquierda" onClick={() => setStyle((s) => ({ ...s, al: s.al === "left" ? undefined : "left" }))}><AlignLeft size={15} /></button>
        <button type="button" className={`${tb} ${selStyle.al === "center" ? tbOn : ""}`} title="Centrar" onClick={() => setStyle((s) => ({ ...s, al: s.al === "center" ? undefined : "center" }))}><AlignCenter size={15} /></button>
        <button type="button" className={`${tb} ${selStyle.al === "right" ? tbOn : ""}`} title="Alinear a la derecha" onClick={() => setStyle((s) => ({ ...s, al: s.al === "right" ? undefined : "right" }))}><AlignRight size={15} /></button>
        <span className="mx-1 h-5 w-px shrink-0 bg-neutral-300" />
        <button type="button" className={tb} title="Quitar formato" onClick={() => setStyle(() => ({}))}><RemoveFormatting size={15} /></button>
      </div>

      {/* Barra de fórmulas */}
      <div className="flex items-center border-b border-neutral-200 text-[13px]">
        <div className="w-[88px] shrink-0 truncate border-r border-neutral-200 px-2 py-1 text-neutral-700">{rangeLabel}</div>
        <div className="px-2 italic text-neutral-400">fx</div>
        <input
          className="min-w-0 flex-1 px-1 py-1 outline-none select-text"
          readOnly={readOnly}
          value={barValue}
          onFocus={() => { if (!editing) startEdit(undefined, "bar"); }}
          onChange={(e) => setEditing({ r: sel.r, c: sel.c, value: e.target.value, source: "bar" })}
          onKeyDown={onEditKey}
          onBlur={() => { if (editingRef.current?.source === "bar") finishEdit(); }}
        />
        {selCell.e && (
          <div className="hidden shrink-0 truncate px-2 text-[11.5px] text-neutral-500 sm:block" title="Quién escribió esta celda">
            Escrito por {selCell.e}
          </div>
        )}
      </div>

      {/* Cuadrícula */}
      <div
        ref={gridRef}
        className="relative min-h-0 flex-1 overflow-auto outline-none"
        onKeyDown={onGridKey}
        onCopy={(e) => onCopy(e)}
        onCut={(e) => onCopy(e, true)}
        onPaste={onPaste}
      >
        <input
          ref={keyInputRef}
          aria-label="Escribir en la celda"
          autoComplete="off"
          autoCapitalize="off"
          className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0"
          onInput={onKeyInput}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={(e) => { composing.current = false; onKeyInput(e); }}
        />
        <table className="border-separate border-spacing-0 text-[13px]" style={{ tableLayout: "fixed", width: HEADER_W + cols.reduce((a, c) => a + colW(c), 0) }}>
          <colgroup>
            <col style={{ width: HEADER_W }} />
            {cols.map((c) => <col key={c} style={{ width: colW(c) }} />)}
          </colgroup>
          <thead>
            <tr>
              <th
                className="sticky left-0 top-0 z-30 border-b border-r border-neutral-300 bg-[#f8f9fa]"
                style={{ height: ROW_H + 2 }}
                onPointerDown={() => { setAnchor({ r: 0, c: 0 }); setSel({ r: rowCount - 1, c: SHEET_MAX_COLS - 1 }); focusGrid(); }}
              />
              {cols.map((c) => {
                const on = c >= range.c1 && c <= range.c2;
                return (
                  <th
                    key={c}
                    className={`relative sticky top-0 z-20 border-b border-r border-neutral-300 text-[11px] font-normal ${on ? "bg-[#d3e3fd] text-[#0b57d0] font-medium" : "bg-[#f8f9fa] text-neutral-600"}`}
                    onPointerDown={(e) => {
                      if (editing) finishEdit();
                      setAnchor({ r: 0, c: e.shiftKey ? anchor.c : c });
                      setSel({ r: rowCount - 1, c });
                      focusGrid();
                    }}
                  >
                    {colName(c)}
                    <span
                      className="absolute right-[-3px] top-0 z-10 h-full w-[6px] cursor-col-resize hover:bg-[#0b57d0]/40"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        resizing.current = { c, startX: e.clientX, startW: colW(c) };
                      }}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const rowOn = r >= range.r1 && r <= range.r2;
              const rowH = tab.rowHeights[r] ?? ROW_H;
              return (
                <tr key={r}>
                  <th
                    className={`sticky left-0 z-10 border-b border-r border-neutral-300 text-[11px] font-normal ${rowOn ? "bg-[#d3e3fd] text-[#0b57d0] font-medium" : "bg-[#f8f9fa] text-neutral-600"}`}
                    style={{ height: rowH }}
                    onPointerDown={(e) => {
                      if (editing) finishEdit();
                      setAnchor({ r: e.shiftKey ? anchor.r : r, c: 0 });
                      setSel({ r, c: SHEET_MAX_COLS - 1 });
                      focusGrid();
                    }}
                  >
                    {r + 1}
                  </th>
                  {cols.map((c) => {
                    const cell = tab.cells[`${r}:${c}`];
                    const s = cell?.s ?? null;
                    const isSel = r === sel.r && c === sel.c;
                    const inRange = r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2;
                    const multi = range.r1 !== range.r2 || range.c1 !== range.c2;
                    const isEditing = editing?.source === "cell" && editing.r === r && editing.c === c;
                    const val = cell ? evalCell(r, c) : "";
                    const shown = cell ? formatValue(val, s) : "";
                    const isNum = typeof val === "number";
                    const align = s?.al ?? (isNum ? "right" : typeof val === "boolean" || typeof val === "object" ? "center" : "left");
                    const img = cell ? imageUrlOf(cell.v) : null;
                    const deco = [s?.u ? "underline" : "", s?.st ? "line-through" : ""].filter(Boolean).join(" ");
                    return (
                      <td
                        key={c}
                        data-cell={`${r}:${c}`}
                        className="relative overflow-hidden whitespace-nowrap border-b border-r border-[#e2e3e3] px-[3px] leading-none"
                        style={{
                          height: rowH,
                          background: inRange && multi && !isSel ? "rgba(11,87,208,0.1)" : s?.bg,
                          color: typeof val === "object" ? "#d93025" : s?.fc,
                          fontWeight: s?.b ? 700 : undefined,
                          fontStyle: s?.i ? "italic" : undefined,
                          textDecoration: deco || undefined,
                          fontSize: s?.fs ? `${s.fs + 3}px` : undefined,
                          textAlign: align,
                        }}
                        onPointerDown={(e) => {
                          if (e.button !== 0) return;
                          if (isEditing) return;
                          if (editing) finishEdit();
                          // En el celular: tocar otra vez la celda ya elegida abre la edición.
                          if (e.pointerType !== "mouse" && isSel && !multi) {
                            e.preventDefault();
                            startEdit();
                            return;
                          }
                          e.preventDefault();
                          select({ r, c }, e.shiftKey);
                          dragging.current = e.pointerType === "mouse";
                          // En el celular no se abre el teclado con solo tocar: se abre al tocar de nuevo.
                          if (e.pointerType === "mouse") focusGrid();
                          else (document.activeElement as HTMLElement | null)?.blur();
                        }}
                        onPointerEnter={() => { if (dragging.current) setSel({ r, c }); }}
                        onDoubleClick={() => startEdit()}
                      >
                        {isEditing ? (
                          <input
                            ref={editInputRef}
                            className="absolute left-0 top-0 z-20 h-full min-w-full bg-white px-[3px] outline-none select-text"
                            style={{ boxShadow: "inset 0 0 0 2px #0b57d0", width: Math.max(colW(c), (editing.value.length + 2) * 8) }}
                            value={editing.value}
                            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                            onKeyDown={onEditKey}
                            onBlur={() => { if (editingRef.current?.source === "cell") finishEdit(); }}
                          />
                        ) : img ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={img} alt="" loading="lazy" draggable={false} className="mx-auto block w-full object-contain" style={{ height: rowH - 6 }} />
                        ) : (
                          shown
                        )}
                        {isSel && !isEditing && <span className="pointer-events-none absolute inset-0 z-10" style={{ boxShadow: "inset 0 0 0 2px #0b57d0" }} />}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rowCount < SHEET_MAX_ROWS && (
          <div className="sticky left-0 px-3 py-3 text-[12.5px] text-neutral-600">
            <button type="button" className="rounded border border-neutral-300 bg-white px-3 py-1 hover:bg-neutral-100" onClick={() => setExtraRows((n) => n + 100)}>
              Agregar 100 filas más
            </button>
          </div>
        )}
      </div>

      {notice && (
        <div className="pointer-events-none fixed bottom-14 left-1/2 z-50 -translate-x-1/2 rounded-md bg-neutral-900 px-4 py-2 text-[13px] text-white shadow-lg">{notice}</div>
      )}

      {/* Pestañas de hojas */}
      <div className="flex items-center gap-1 border-t border-neutral-200 bg-[#f9fbfd] px-2 py-1 text-[13px]">
        {canWrite && <button type="button" className={tb} title="Agregar hoja" onClick={() => void addTab()}><Plus size={17} /></button>}
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {tabs.map((t) => {
            const on = t.id === tab.id;
            return (
              <div key={t.id} className={`relative flex shrink-0 items-center rounded-t px-2.5 py-1 ${on ? "bg-[#e1e9f7] font-medium text-[#0b57d0]" : "text-neutral-700 hover:bg-neutral-200"}`}>
                {renaming?.id === t.id ? (
                  <input
                    autoFocus
                    className="w-28 rounded border border-[#0b57d0] bg-white px-1 outline-none select-text"
                    value={renaming.name}
                    onChange={(e) => setRenaming({ id: t.id, name: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter") renameTab(t.id, renaming.name); if (e.key === "Escape") setRenaming(null); }}
                    onBlur={() => renameTab(t.id, renaming.name)}
                  />
                ) : (
                  <button
                    type="button"
                    className="cursor-pointer"
                    onClick={() => { if (editing) finishEdit(); setActiveId(t.id); select({ r: 0, c: 0 }); undoStack.current = []; redoStack.current = []; }}
                    onDoubleClick={() => { if (canWrite && !t.locked && !t.autoCols.length && (!t.createdBySide || t.createdBySide === side)) setRenaming({ id: t.id, name: t.name }); }}
                  >
                    {t.locked && <Lock size={11} className="mr-1 inline -mt-0.5" />}
                    {t.name}
                  </button>
                )}
                {canWrite && !t.locked && !t.autoCols.length && (!t.createdBySide || t.createdBySide === side) && (<button
                  type="button"
                  className="ml-1 rounded p-0.5 hover:bg-black/10"
                  title="Opciones de la hoja"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setTabMenu(tabMenu === t.id ? null : t.id)}
                >
                  <ChevronDown size={13} />
                </button>)}
                {tabMenu === t.id && (
                  <div className="absolute bottom-full left-0 z-40 mb-1 w-40 rounded border border-neutral-200 bg-white py-1 shadow-lg" onPointerDown={(e) => e.stopPropagation()}>
                    <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-neutral-100" onClick={() => { setTabMenu(null); setRenaming({ id: t.id, name: t.name }); }}>
                      Cambiar nombre
                    </button>
                    <button
                      type="button"
                      className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-neutral-100 disabled:text-neutral-400"
                      disabled={tabs.filter((x) => !x.locked).length <= 1}
                      onClick={() => deleteTab(t.id)}
                    >
                      Eliminar
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
