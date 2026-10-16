import { DROPI_MCP_URL, NickReconnectError, getValidAccessToken, markReconnect } from "@/lib/nick/dropiOAuth";
import { prisma } from "@/lib/prisma";

// Cliente mínimo del conector oficial de Dropi (protocolo MCP por HTTP).
// Solo se usan herramientas de LECTURA: NICK nunca crea ni cambia órdenes.
const PROTOCOL_VERSION = "2025-06-18";

type JsonRpcResponse = { id?: number; result?: unknown; error?: { code: number; message: string } };
type McpTool = { name: string; description?: string; inputSchema?: { properties?: Record<string, unknown>; required?: string[] } };

class McpSession {
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
    if (res.status === 401 || res.status === 403) await markReconnect(this.accountId, "Dropi pidió volver a conectar la cuenta.");
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

export type NickGuideRow = {
  orderId: string | null;
  guide: string | null;
  status: string | null;
  carrier: string | null;
  city: string | null;
  date: string | null;
};

export type NickReadResult = {
  tools: string[];
  orderTool: string | null;
  fields: string[];
  rows: NickGuideRow[];
  note: string | null;
};

// Montos fuera: el equipo de Inventario no ve dinero (y NICK etapa 0 tampoco).
const MONEY_KEY = /price|precio|total|amount|monto|valor|value|cost|costo|profit|ganancia|recaudo|commission|comision|wallet|saldo|balance|flete|shipping_amount|rate/i;

function findArray(v: unknown, depth = 0): Record<string, unknown>[] | null {
  if (depth > 4 || v === null || typeof v !== "object") return null;
  if (Array.isArray(v)) return v.length && typeof v[0] === "object" ? (v as Record<string, unknown>[]) : null;
  for (const val of Object.values(v as Record<string, unknown>)) {
    const found = findArray(val, depth + 1);
    if (found) return found;
  }
  return null;
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

function toRow(o: Record<string, unknown>): NickGuideRow {
  return {
    orderId: pick(o, /^(id|order_id|orderid)$/i),
    guide: pick(o, /guia|guide|tracking|shipping_guide/i),
    status: pick(o, /^(status|estado|state|order_status)$/i) ?? pick(o, /status|estado/i),
    carrier: pick(o, /carrier|transport|distribution_company|courier/i),
    city: pick(o, /^(city|ciudad|destination_city|city_name)$/i) ?? pick(o, /city|ciudad/i),
    date: pick(o, /^(created_at|fecha|date|order_date|created)$/i),
  };
}

function fieldNames(o: Record<string, unknown>, prefix = "", depth = 0): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (MONEY_KEY.test(k)) continue;
    out.push(prefix + k);
    if (depth < 1 && v && typeof v === "object" && !Array.isArray(v)) out.push(...fieldNames(v as Record<string, unknown>, `${prefix}${k}.`, depth + 1));
  }
  return out;
}

// Rellena solo la paginación que pida la herramienta (si la pide).
function pagingArgs(tool: McpTool, size: number): Record<string, unknown> {
  const props = tool.inputSchema?.properties ?? {};
  const args: Record<string, unknown> = {};
  for (const k of Object.keys(props)) {
    if (/^(limit|per_page|perpage|page_size|pagesize|size|result_number)$/i.test(k)) args[k] = size;
    else if (/^(page|start)$/i.test(k)) args[k] = /start/i.test(k) ? 0 : 1;
  }
  return args;
}

export async function readLatestGuides(accountId: string, size = 20): Promise<NickReadResult> {
  const token = await getValidAccessToken(accountId);
  const mcp = new McpSession(accountId, token);
  try {
    await mcp.init();
    const tools = await mcp.listTools();
    const orderTool =
      tools.find((t) => /^list[_ ]?orders$/i.test(t.name)) ??
      tools.find((t) => /list/i.test(t.name) && /order/i.test(t.name) && !/status/i.test(t.name)) ??
      null;
    const result: NickReadResult = { tools: tools.map((t) => t.name), orderTool: orderTool?.name ?? null, fields: [], rows: [], note: null };
    if (!orderTool) {
      result.note = "Dropi no ofrece una herramienta para listar órdenes en esta cuenta.";
    } else {
      const r = await mcp.callTool(orderTool.name, pagingArgs(orderTool, size));
      let payload: unknown = r.structuredContent;
      if (payload === undefined) {
        const text = (r.content ?? []).map((c) => c.text ?? "").join("\n");
        try {
          payload = JSON.parse(text);
        } catch {
          payload = null;
          result.note = text.slice(0, 300) || "Dropi no devolvió datos.";
        }
      }
      if (r.isError) result.note = `Dropi respondió con un error al listar órdenes.`;
      const list = findArray(payload) ?? [];
      result.rows = list.slice(0, size).map(toRow);
      result.fields = list[0] ? fieldNames(list[0]).slice(0, 80) : [];
      if (!list.length && !result.note) result.note = "Dropi no devolvió órdenes.";
    }
    await prisma.nickDropiAccount.update({ where: { id: accountId }, data: { lastReadAt: new Date(), lastError: null } });
    return result;
  } catch (e) {
    if (e instanceof NickReconnectError) throw e;
    const msg = e instanceof Error ? e.message : "Error leyendo Dropi";
    await prisma.nickDropiAccount.update({ where: { id: accountId }, data: { lastError: msg.slice(0, 300) } });
    throw e;
  }
}
