// Confirmado 2026-09-24, pedido explícito del usuario: hoja de cálculo en
// línea (estilo Excel/Google Sheets) del enlace de CHEN. Acá vive lo que
// comparten la página y la API: tamaño máximo, nombres de columnas (A, B…),
// fórmulas básicas (=SUMA(A1:A5), =A1*B1…) y cómo se muestra cada número.

export const SHEET_MAX_ROWS = 1000;
export const SHEET_MAX_COLS = 26;

export type CellStyle = {
  b?: boolean; // negrita
  i?: boolean; // cursiva
  u?: boolean; // subrayado
  st?: boolean; // tachado
  fc?: string; // color de letra
  bg?: string; // color de relleno
  al?: "left" | "center" | "right";
  fs?: number; // tamaño de letra
  fmt?: "currency" | "percent" | "number";
  dp?: number; // decimales
};

// a/e: de qué lado es y qué correo la escribió (antifraude, ver la API).
export type SheetSide = "SUPPLIER" | "OWN";
export type Cell = { v: string; s: CellStyle | null; a?: SheetSide | null; e?: string | null };

// Si la celda es =IMAGEN("https://…") devuelve el enlace de la foto.
export function imageUrlOf(v: string): string | null {
  const m = /^=\s*IMAGEN?\s*\(\s*"(https:\/\/[^"]+)"\s*\)\s*$/i.exec(v);
  return m ? m[1] : null;
}

export function colName(c: number) {
  let n = c + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function cellName(r: number, c: number) {
  return `${colName(c)}${r + 1}`;
}

function parseRef(ref: string): { r: number; c: number } | null {
  const m = /^\$?([A-Z]{1,2})\$?(\d{1,5})$/.exec(ref.toUpperCase());
  if (!m) return null;
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  const r = Number(m[2]) - 1;
  if (r < 0) return null;
  return { r, c: c - 1 };
}

// ---------- Fórmulas ----------

type Val = number | string | boolean;
class FormulaError extends Error {}

type Tok = { t: "num"; v: number } | { t: "str"; v: string } | { t: "ref"; v: string } | { t: "name"; v: string } | { t: "op"; v: string };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9.]/.test(ch)) {
      const m = /^[0-9]*\.?[0-9]+(e[+-]?[0-9]+)?|^[0-9]+\.?/i.exec(src.slice(i));
      if (!m) throw new FormulaError();
      toks.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (ch === '"') {
      const end = src.indexOf('"', i + 1);
      if (end < 0) throw new FormulaError();
      toks.push({ t: "str", v: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$.]*/.exec(src.slice(i))!;
      const word = m[0];
      i += word.length;
      if (parseRef(word)) toks.push({ t: "ref", v: word.toUpperCase().replace(/\$/g, "") });
      else toks.push({ t: "name", v: word.toUpperCase() });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") { toks.push({ t: "op", v: two }); i += 2; continue; }
    if ("+-*/^()&,;:=<>%".includes(ch)) { toks.push({ t: "op", v: ch }); i++; continue; }
    throw new FormulaError();
  }
  return toks;
}

type Getter = (r: number, c: number) => Val;

function toNum(v: Val): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v.trim() === "") return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new FormulaError("#VALOR!");
  return n;
}

function toStr(v: Val) {
  if (typeof v === "boolean") return v ? "VERDADERO" : "FALSO";
  return String(v);
}

function evaluate(src: string, get: Getter): Val {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === "op" && peek()!.v === v;
  const expectOp = (v: string) => {
    if (!isOp(v)) throw new FormulaError();
    p++;
  };

  // Un argumento de función puede ser un rango (A1:B5) — devuelve la lista de valores.
  function argValues(): Val[] {
    const t = peek();
    const t2 = toks[p + 1];
    if (t?.t === "ref" && t2?.t === "op" && t2.v === ":") {
      const a = parseRef(t.v)!;
      p += 2;
      const bt = peek();
      if (bt?.t !== "ref") throw new FormulaError();
      p++;
      const b = parseRef(bt.v)!;
      const out: Val[] = [];
      for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++)
        for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++) out.push(get(r, c));
      return out;
    }
    return [comparison()];
  }

  function call(name: string): Val {
    expectOp("(");
    const args: Val[][] = [];
    if (!isOp(")")) {
      args.push(argValues());
      while (isOp(",") || isOp(";")) { p++; args.push(argValues()); }
    }
    expectOp(")");
    const flat = args.flat();
    const nums = () => flat.filter((v) => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)))).map(toNum);
    switch (name) {
      case "SUM": case "SUMA": return nums().reduce((a, b) => a + b, 0);
      case "AVERAGE": case "PROMEDIO": { const n = nums(); if (!n.length) throw new FormulaError("#DIV/0!"); return n.reduce((a, b) => a + b, 0) / n.length; }
      case "MIN": { const n = nums(); return n.length ? Math.min(...n) : 0; }
      case "MAX": { const n = nums(); return n.length ? Math.max(...n) : 0; }
      case "COUNT": case "CONTAR": return nums().length;
      case "COUNTA": case "CONTARA": return flat.filter((v) => toStr(v) !== "").length;
      case "ROUND": case "REDONDEAR": { const d = args[1] ? toNum(args[1][0]) : 0; const f = 10 ** d; return Math.round(toNum(args[0]?.[0] ?? 0) * f) / f; }
      case "ABS": return Math.abs(toNum(args[0]?.[0] ?? 0));
      case "IF": case "SI": { const c = args[0]?.[0]; const ok = typeof c === "boolean" ? c : toNum(c ?? 0) !== 0; return ok ? (args[1]?.[0] ?? true) : (args[2]?.[0] ?? false); }
      case "CONCAT": case "CONCATENAR": return flat.map(toStr).join("");
      // Confirmado 2026-09-24: =IMAGEN("https://…") muestra la foto en la
      // celda (como IMAGE de Google Sheets); como valor devuelve el enlace.
      case "IMAGE": case "IMAGEN": return toStr(args[0]?.[0] ?? "");
      case "TRUE": case "VERDADERO": return true;
      case "FALSE": case "FALSO": return false;
      default: throw new FormulaError("#NOMBRE?");
    }
  }

  function primary(): Val {
    const t = peek();
    if (!t) throw new FormulaError();
    if (t.t === "num") { p++; return t.v; }
    if (t.t === "str") { p++; return t.v; }
    if (t.t === "ref") { p++; const { r, c } = parseRef(t.v)!; return get(r, c); }
    if (t.t === "name") { p++; return call(t.v); }
    if (isOp("(")) { p++; const v = comparison(); expectOp(")"); return v; }
    throw new FormulaError();
  }
  function postfix(): Val {
    let v = primary();
    while (isOp("%")) { p++; v = toNum(v) / 100; }
    return v;
  }
  function unary(): Val {
    if (isOp("-")) { p++; return -toNum(unary()); }
    if (isOp("+")) { p++; return toNum(unary()); }
    return postfix();
  }
  function power(): Val {
    const base = unary();
    if (isOp("^")) { p++; return toNum(base) ** toNum(power()); }
    return base;
  }
  function term(): Val {
    let v = power();
    while (isOp("*") || isOp("/")) {
      const op = toks[p++].v;
      const rhs = toNum(power());
      if (op === "/" && rhs === 0) throw new FormulaError("#DIV/0!");
      v = op === "*" ? toNum(v) * rhs : toNum(v) / rhs;
    }
    return v;
  }
  function additive(): Val {
    let v = term();
    while (isOp("+") || isOp("-")) {
      const op = toks[p++].v;
      const rhs = toNum(term());
      v = op === "+" ? toNum(v) + rhs : toNum(v) - rhs;
    }
    return v;
  }
  function concat(): Val {
    let v = additive();
    while (isOp("&")) { p++; v = toStr(v) + toStr(additive()); }
    return v;
  }
  function comparison(): Val {
    const a = concat();
    const t = peek();
    if (t?.t === "op" && ["=", "<>", "<", ">", "<=", ">="].includes(t.v)) {
      p++;
      const b = concat();
      const both = typeof a === "number" || typeof b === "number";
      const x = both ? toNum(a) : toStr(a).toLowerCase();
      const y = both ? toNum(b) : toStr(b).toLowerCase();
      switch (t.v) {
        case "=": return x === y;
        case "<>": return x !== y;
        case "<": return x < y;
        case ">": return x > y;
        case "<=": return x <= y;
        default: return x >= y;
      }
    }
    return a;
  }

  const result = comparison();
  if (p !== toks.length) throw new FormulaError();
  return result;
}

// Calcula todos los valores que se ven en pantalla de una hoja. Devuelve una
// función (r, c) → valor ya calculado; las fórmulas se resuelven una sola vez.
export function makeEvaluator(cells: Record<string, Cell>) {
  const cache = new Map<string, Val | { err: string }>();
  const visiting = new Set<string>();

  function raw(r: number, c: number): Val {
    const key = `${r}:${c}`;
    const cell = cells[key];
    if (!cell || cell.v === "") return "";
    if (!cell.v.startsWith("=")) {
      const n = Number(cell.v.trim());
      return cell.v.trim() !== "" && Number.isFinite(n) ? n : cell.v;
    }
    const cached = cache.get(key);
    if (cached !== undefined) {
      if (typeof cached === "object") throw new FormulaError(cached.err);
      return cached;
    }
    if (visiting.has(key)) throw new FormulaError("#CIRC!");
    visiting.add(key);
    try {
      const v = evaluate(cell.v.slice(1), raw);
      cache.set(key, v);
      return v;
    } catch (e) {
      const err = e instanceof FormulaError && e.message ? e.message : "#ERROR!";
      cache.set(key, { err });
      throw new FormulaError(err);
    } finally {
      visiting.delete(key);
    }
  }

  return (r: number, c: number): Val | { err: string } => {
    try {
      return raw(r, c);
    } catch (e) {
      return { err: e instanceof FormulaError && e.message ? e.message : "#ERROR!" };
    }
  };
}

export function formatValue(v: Val | { err: string }, s: CellStyle | null): string {
  if (typeof v === "object") return v.err;
  if (typeof v === "boolean") return v ? "VERDADERO" : "FALSO";
  if (typeof v === "string") return v;
  if (s?.fmt === "currency") return `$${v.toLocaleString("en-US", { minimumFractionDigits: s.dp ?? 2, maximumFractionDigits: s.dp ?? 2 })}`;
  if (s?.fmt === "percent") return `${(v * 100).toLocaleString("en-US", { minimumFractionDigits: s.dp ?? 0, maximumFractionDigits: s.dp ?? 0 })}%`;
  if (s?.fmt === "number" || s?.dp != null) return v.toLocaleString("en-US", { minimumFractionDigits: s?.dp ?? 2, maximumFractionDigits: s?.dp ?? 2 });
  // Sin formato: como lo muestra Excel, sin ruido de decimales flotantes.
  return String(Math.round(v * 1e10) / 1e10);
}
