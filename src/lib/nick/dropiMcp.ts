import { DROPI_MCP_URL, getValidAccessToken, markReconnect } from "@/lib/nick/dropiOAuth";
import { prisma } from "@/lib/prisma";

// Cliente mínimo del conector oficial de Dropi (protocolo MCP por HTTP).
// Solo se usan herramientas de LECTURA: NICK nunca crea ni cambia órdenes.
const PROTOCOL_VERSION = "2025-06-18";

type JsonRpcResponse = { id?: number; result?: unknown; error?: { code: number; message: string } };
type McpTool = { name: string; description?: string; inputSchema?: { properties?: Record<string, unknown>; required?: string[] } };

export class McpSession {
  private nextId = 1;
  private sessionId: string | null = null;
  constructor(private accountId: string, private token: string) {}

  private async send(method: string, params?: unknown, notify = false): Promise<unknown> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${this.token}`,
      "MCP-Protocol-Version": PROTOCOL_VERSION,
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    const id = notify ? undefined : this.nextId++;
    const res = await fetch(DROPI_MCP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", method, ...(id !== undefined ? { id } : {}), ...(params !== undefined ? { params } : {}) }),
    });
    if (res.status === 401) await markReconnect(this.accountId, "Dropi pidió volver a conectar la cuenta.");
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    if (notify) return null;
    if (!res.ok) throw new Error(`Dropi respondió ${res.status}`);
    const text = await res.text();
    const msg = parseResponse(text, id!);
    if (msg?.error) throw new Error(`Dropi: ${msg.error.message}`);
    return msg?.result;
  }

  async init() {
    await this.send("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "DAFLOW NICK", version: "0.1.0" },
    });
    await this.send("notifications/initialized", undefined, true);
  }

  async listTools(): Promise<McpTool[]> {
    const r = (await this.send("tools/list", {})) as { tools?: McpTool[] } | undefined;
    return r?.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>) {
    return (await this.send("tools/call", { name, arguments: args })) as {
      content?: { type: string; text?: string }[];
      structuredContent?: unknown;
      isError?: boolean;
    };
  }
}

// La respuesta llega como JSON o como "event-stream" (líneas data: {...}).
function parseResponse(text: string, id: number): JsonRpcResponse | null {
  const t = text.trim();
  if (t.startsWith("{")) return JSON.parse(t) as JsonRpcResponse;
  for (const line of t.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const m = JSON.parse(line.slice(5).trim()) as JsonRpcResponse;
      if (m.id === id) return m;
    } catch {
      /* línea incompleta */
    }
  }
  return null;
}

// Montos fuera: el equipo de Inventario no ve dinero (y NICK etapa 0 tampoco).
const MONEY_KEY = /price|precio|total|amount|monto|valor|value|cost|costo|profit|ganancia|recaudo|commission|comision|wallet|saldo|balance|flete|shipping_amount|rate/i;

// Dropi no responde en JSON sino en un texto tabular compacto (visto
// 2026-10-15 con IMPORTADORA DAMIAN):
//   items[20]{order_id,status,customer_name,...}:
//     "7496338",PENDIENTE,Geovanny Corral,"959961660",QUITO,27.99,...
// Se separan los valores respetando comillas y cada N valores es una fila.
function splitValues(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === "\\" && i + 1 < s.length) cur += s[++i];
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === "\n") {
      out.push(cur.trim());
      cur = "";
      // saltos de línea seguidos / sangría no son valores vacíos
      while (s[i + 1] === "\n" || s[i + 1] === "\r" || (ch === "\n" && s[i + 1] === " ")) i++;
    } else if (ch !== "\r") cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// Cuando las filas no tienen todas los mismos campos (ej. unas con
// tracking_code y otras sin guía todavía), Dropi cambia a lista:
//   items[100]:
//     - order_id: "7496338"
//       status: PENDIENTE
//       ...
// (visto 2026-10-16 al pedir 100 por página).
function parseDropiList(text: string): Record<string, unknown>[] | null {
  const m = /([\w.]+)\[(\d+)\]:\s*\n/.exec(text);
  if (!m) return null;
  const rows: Record<string, unknown>[] = [];
  let cur: Record<string, unknown> | null = null;
  let itemIndent = -1;
  for (const line of text.slice(m.index + m[0].length).split("\n")) {
    const start = /^(\s*)-\s+([\w.]+):\s*(.*)$/.exec(line);
    if (start) {
      cur = {};
      rows.push(cur);
      itemIndent = start[1].length + 2;
      cur[start[2]] = clean(start[3]);
      continue;
    }
    const kv = /^(\s*)([\w.]+):\s*(.*)$/.exec(line);
    if (kv && cur && kv[1].length >= itemIndent && !(kv[2] in cur)) cur[kv[2]] = clean(kv[3]);
    else if (kv && kv[1].length < itemIndent) break; // terminó la lista
  }
  return rows.length ? rows : null;
}

function clean(v: string) {
  return v.trim().replace(/^"(.*)"$/, "$1");
}

export function parseDropiTable(text: string): Record<string, unknown>[] | null {
  const m = /([\w.]+)\[(\d+)\]\{([^}]*)\}:\s*/.exec(text);
  const list = /([\w.]+)\[(\d+)\]:\s*\n/.exec(text);
  // La cabecera que aparece primero manda (una lista puede traer tablas adentro).
  if (!m || (list && list.index < m.index)) return parseDropiList(text);
  const fields = m[3].split(",").map((f) => f.trim());
  const count = Number(m[2]);
  // Cuerpo hasta la siguiente cabecera de tabla (si hubiera otra).
  const rest = text.slice(m.index + m[0].length);
  const next = /\n\S[\w.]*(\[\d+\])?(\{[^}]*\})?:/.exec(rest);
  const values = splitValues(next ? rest.slice(0, next.index) : rest);
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i + fields.length <= values.length && rows.length < count; i += fields.length) {
    const row: Record<string, unknown> = {};
    fields.forEach((f, j) => (row[f] = values[i + j]));
    rows.push(row);
  }
  return rows.length ? rows : null;
}

// Detalle de una orden: líneas "clave: valor" (con sangría si va anidado).
function parseDropiObject(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const line of text.split("\n")) {
    const m = /^\s*([\w.]+):\s*(.+)$/.exec(line);
    if (m && !(m[1] in out)) out[m[1]] = m[2].replace(/^"(.*)"$/, "$1").trim();
  }
  return out;
}

// Detalle: líneas "clave: valor" + la primera fila de cada tabla que traiga
// (ej. items[1]{...}), con el nombre de la tabla adelante.
function parseDropiDetail(text: string): Record<string, unknown> {
  const out = parseDropiObject(text);
  const header = /([\w.]+)\[\d+\]\{[^}]*\}:/g;
  let m: RegExpExecArray | null;
  while ((m = header.exec(text))) {
    const first = parseDropiTable(text.slice(m.index))?.[0];
    if (first) for (const [k, v] of Object.entries(first)) out[`${m[1]}.${k}`] = v;
    delete out[m[1]];
  }
  return out;
}

export function toolText(r:{ content?: { type: string; text?: string }[] }) {
  return (r.content ?? []).map((c) => c.text ?? "").join("\n");
}

// Busca el primer campo cuyo nombre coincida (también dentro de objetos
// anidados, ej. distribution_company.name) y lo devuelve como texto.
function pick(obj: Record<string, unknown>, re: RegExp, depth = 0): string | null {
  for (const [k, v] of Object.entries(obj)) {
    if (MONEY_KEY.test(k)) continue;
    if (re.test(k)) {
      if (typeof v === "string" || typeof v === "number") return String(v);
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const name = (v as Record<string, unknown>).name ?? (v as Record<string, unknown>).nombre;
        if (typeof name === "string") return name;
      }
    }
  }
  if (depth < 2) {
    for (const v of Object.values(obj)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const found = pick(v as Record<string, unknown>, re, depth + 1);
        if (found) return found;
      }
    }
  }
  return null;
}

// Guía de UNA orden (garantías de Rocket, 2026-10-16). get_order pide el id
// como texto y trae tracking_code cuando Dropi ya generó la guía (visto
// 2026-10-15). found=false: la orden no es de esta cuenta.
export async function findOrderGuide(accountId: string, orderId: string): Promise<{ found: boolean; guide: string | null; status: string | null }> {
  const token = await getValidAccessToken(accountId);
  const mcp = new McpSession(accountId, token);
  await mcp.init();
  const tools = await mcp.listTools();
  const detailTool =
    tools.find((t) => /^get[_ ]?order$/i.test(t.name)) ?? tools.find((t) => /order/i.test(t.name) && /get|detail/i.test(t.name) && !/status|list/i.test(t.name));
  if (!detailTool) return { found: false, guide: null, status: null };
  const idKey = Object.keys(detailTool.inputSchema?.properties ?? {}).find((k) => /order_?id|^id$/i.test(k)) ?? detailTool.inputSchema?.required?.[0] ?? "id";
  const d = await mcp.callTool(detailTool.name, { [idKey]: orderId }).catch(() => null);
  if (!d || d.isError) return { found: false, guide: null, status: null };
  const text = toolText(d);
  let obj: Record<string, unknown>;
  if (d.structuredContent && typeof d.structuredContent === "object") obj = d.structuredContent as Record<string, unknown>;
  else {
    try {
      obj = JSON.parse(text) as Record<string, unknown>;
    } catch {
      obj = parseDropiDetail(text);
    }
  }
  const id = pick(obj, /^(id|order_id|orderid)$/i);
  if (!id || id.replace(/\D/g, "") !== orderId.replace(/\D/g, "")) return { found: false, guide: null, status: null };
  const guide = pick(obj, /guia|guide|tracking/i);
  await prisma.nickDropiAccount.update({ where: { id: accountId }, data: { lastReadAt: new Date(), lastError: null } }).catch(() => null);
  return { found: true, guide: guide && /\w{5,}/.test(guide) ? guide.toUpperCase().replace(/\s+/g, "") : null, status: pick(obj, /^(status|estado)$/i) };
}

