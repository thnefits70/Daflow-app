import { prisma } from "@/lib/prisma";
import { notifyOwner } from "@/lib/notifications";
import { getInventoryLeadId, getPurchaseGestionManagerId } from "@/lib/guards";
import { getAnthropicClient } from "@/lib/nancy";
import { logAiUsage } from "@/lib/aiUsage";
import { getOrderSummary, type OrderStage } from "@/lib/supplierSheetAuto";

// Confirmado 2026-09-24, pedido explícito del usuario: lo que la gente de
// CHEN anota en la hoja aparece dentro de DAFLOW (Control de Compras →
// "Notas de Chen") y le avisa SOLO a quien le corresponde, sin que nadie
// tenga que reenviar nada a mano:
//   A) Según la etapa del pedido de esa fila (gratis):
//      en camino → quien lo compró (Jariel) + Inventario (líder y equipo)
//      daño/faltante por reponer → quien lo compró + líder de Inventario
//      llegó bien / pago en proceso / pagado → el admin (paga)
//      fila de un pago/comprobante → el admin
//   B) La IA decide SOLO cuando A no alcanza: la nota habla de pago o precio
//      y eso no coincide con la etapa, o la nota no está al lado de ningún
//      pedido/pago (hoja libre). Si la IA falla: A + admin, nunca se pierde.
// Una nota por celda; si CHEN la edita, se vuelve a avisar solo si pasaron
// 20 minutos desde el último aviso (para no avisar por cada corrección).

const NOTE_AI_MODEL = "claude-haiku-4-5";
const RENOTIFY_AFTER_MS = 20 * 60 * 1000;
const PAYMENT_WORDS = /pag[oaó]|pagar|transfer|dep[oó]sit|abono|comprobante|deuda|cobr/i;
const PRICE_WORDS = /precio|costo|valor|cobr|\$|usd|d[oó]lar/i;
const PAY_STAGES: OrderStage[] = ["por_pagar", "pago_en_proceso", "pagado"];

type Role = "compras" | "inventario" | "inventario_lider" | "pagos";

async function inventoryTeamIds() {
  const [lead, team] = await Promise.all([
    getInventoryLeadId(),
    prisma.user.findMany({ where: { isActive: true, department: { code: "INV" } }, select: { id: true } }),
  ]);
  return [...new Set([lead, ...team.map((u) => u.id)].filter((x): x is string => !!x))];
}

async function idsForRoles(roles: Role[], requesterId: string | null) {
  const ids = new Set<string>();
  if (roles.includes("compras")) {
    const buyer = requesterId ?? (await getPurchaseGestionManagerId());
    if (buyer) ids.add(buyer);
  }
  if (roles.includes("inventario")) for (const id of await inventoryTeamIds()) ids.add(id);
  if (roles.includes("inventario_lider")) {
    const lead = await getInventoryLeadId();
    if (lead) ids.add(lead);
  }
  if (roles.includes("pagos")) ids.add("admin");
  return [...ids];
}

function rolesForStage(stage: OrderStage): Role[] {
  if (stage === "en_camino") return ["compras", "inventario"];
  if (stage === "reposicion") return ["compras", "inventario_lider"];
  return ["pagos"];
}

async function rolesByAi(params: { text: string; context: string; supplierId: string }): Promise<{ roles: Role[]; reason: string } | null> {
  try {
    const client = getAnthropicClient();
    const res = await client.messages.create({
      model: NOTE_AI_MODEL,
      max_tokens: 200,
      system:
        "Un proveedor de mercadería (CHEN, puede escribir en español o chino) dejó una nota en una hoja compartida con una importadora de Guayaquil. " +
        "Decide qué área de la importadora debe enterarse. Áreas: " +
        '"compras" (coordina pedidos, precios acordados, reposiciones y cambios con el proveedor), ' +
        '"inventario" (recibe y revisa la mercadería en bodega, envíos que van a llegar), ' +
        '"pagos" (el dueño, que paga al proveedor: pagos, transferencias, comprobantes, deudas). ' +
        "Puedes elegir más de una solo si de verdad corresponde. " +
        'Responde ÚNICAMENTE un JSON: {"roles": ["compras"|"inventario"|"pagos"], "motivo": "frase corta en español"}.',
      messages: [{ role: "user", content: `Contexto: ${params.context}\n\nNota del proveedor: """${params.text.slice(0, 1500)}"""` }],
    });
    await logAiUsage({
      feature: "proveedor_hoja_nota_aviso",
      model: NOTE_AI_MODEL,
      actorId: `proveedor:${params.supplierId}`,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
    });
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as { roles?: string[]; motivo?: string };
    const roles = (json.roles ?? []).filter((r): r is Role => r === "compras" || r === "inventario" || r === "pagos");
    return roles.length ? { roles, reason: json.motivo?.slice(0, 200) ?? "" } : null;
  } catch (e) {
    console.error("IA de notas de la hoja de CHEN falló:", e);
    return null;
  }
}

const STAGE_LABEL: Record<OrderStage, string> = {
  en_camino: "en camino",
  reposicion: "con daño/faltante por reponer",
  por_pagar: "llegó bien, falta pagar",
  pago_en_proceso: "pago en proceso",
  pagado: "ya pagado",
};

async function comprasDeptId() {
  const d = await prisma.department.findFirst({ where: { code: "COM" }, select: { id: true } });
  return d?.id ?? null;
}

export async function recordSupplierSheetNote(params: {
  supplierId: string;
  tabId: string;
  tabName: string;
  rowKey: string | null; // null = hoja libre
  row: number;
  col: number;
  text: string;
  authorEmail: string;
}) {
  const noteKey = `${params.tabId}|${params.rowKey ?? `pos:${params.row}`}|${params.col}`;
  const text = params.text.trim();
  const existing = await prisma.supplierSheetNote.findUnique({ where: { noteKey } });

  // Borró la nota: queda en el historial marcada como borrada, sin aviso.
  if (!text) {
    if (existing && !existing.clearedAt) await prisma.supplierSheetNote.update({ where: { id: existing.id }, data: { clearedAt: new Date() } });
    return;
  }
  // Encabezados que CHEN ponga a sus columnas: no son notas.
  if (params.rowKey === "h" || params.rowKey === "ph" || params.rowKey === "ph2") return;
  // En la hoja libre, solo lo que parece un mensaje (no un número o una palabra suelta).
  if (!params.rowKey && (text.length < 12 || !/\s/.test(text))) return;

  const requestId = params.rowKey?.startsWith("r:") ? params.rowKey.slice(2) : null;
  const debtPaymentId = params.rowKey?.startsWith("pt:") ? params.rowKey.slice(3) : null;
  const order = requestId ? await getOrderSummary(params.supplierId, requestId) : null;

  const shouldNotify = !existing || existing.text !== text
    ? !existing?.lastNotifiedAt || Date.now() - existing.lastNotifiedAt.getTime() > RENOTIFY_AFTER_MS
    : false;

  let notifiedTo = existing?.notifiedTo ?? [];
  let routeMethod = existing?.routeMethod ?? null;
  let routeReason = existing?.routeReason ?? null;
  if (shouldNotify) {
    const isPaymentRow = !!params.rowKey && (params.rowKey.startsWith("t:") || params.rowKey.startsWith("pt:"));
    let stageRoles: Role[] | null = order ? rolesForStage(order.stage) : isPaymentRow ? ["pagos"] : null;
    const mismatch =
      !stageRoles ||
      (PRICE_WORDS.test(text) && !isPaymentRow) ||
      (PAYMENT_WORDS.test(text) && !!order && !PAY_STAGES.includes(order.stage));
    let roles: Role[];
    if (!mismatch && stageRoles) {
      roles = stageRoles;
      routeMethod = "etapa";
      routeReason = order ? `Pedido ${STAGE_LABEL[order.stage]}` : "Nota en un pago";
    } else {
      const context = order
        ? `Nota al lado del pedido "${order.productName}" (${order.quantity} un.), que está ${STAGE_LABEL[order.stage]}.`
        : isPaymentRow
          ? "Nota al lado de un pago/comprobante."
          : `Nota en la hoja libre "${params.tabName}", no está al lado de ningún pedido.`;
      const ai = await rolesByAi({ text, context, supplierId: params.supplierId });
      if (ai) {
        roles = ai.roles;
        routeMethod = "ia";
        routeReason = ai.reason || null;
      } else {
        stageRoles = stageRoles ?? ["compras"];
        roles = [...new Set<Role>([...stageRoles, "pagos"])];
        routeMethod = "respaldo";
        routeReason = "La IA no respondió — se avisó por etapa y al admin";
      }
    }
    notifiedTo = await idsForRoles(roles, order?.requestedById ?? null);
  }

  const note = await prisma.supplierSheetNote.upsert({
    where: { noteKey },
    create: {
      noteKey,
      supplierId: params.supplierId,
      tabId: params.tabId,
      tabName: params.tabName,
      requestId,
      debtPaymentId,
      text,
      authorEmail: params.authorEmail,
      notifiedTo,
      routeMethod,
      routeReason,
      lastNotifiedAt: shouldNotify ? new Date() : null,
    },
    update: {
      text,
      authorEmail: params.authorEmail,
      tabName: params.tabName,
      clearedAt: null,
      notifiedTo,
      routeMethod,
      routeReason,
      ...(shouldNotify ? { lastNotifiedAt: new Date() } : {}),
    },
  });

  if (!shouldNotify || notifiedTo.length === 0) return;
  const deptId = order?.deptId ?? (await comprasDeptId());
  const where = order ? `${order.productName} (${order.quantity} un.)` : params.tabName;
  const body = `${where}: "${text.length > 140 ? `${text.slice(0, 140)}…` : text}"`;
  await Promise.all(
    notifiedTo.map((ownerId) =>
      notifyOwner(ownerId, {
        title: existing ? "Chen actualizó una nota" : "Nota nueva de Chen",
        body,
        url:
          ownerId === "admin" && deptId
            ? `/admin/dept/${deptId}?tab=compras&ptab=notas-chen&nota=${note.id}`
            : `/area/workspace?tab=compras&ptab=notas-chen&nota=${note.id}`,
      }).catch(() => null),
    ),
  );
}
