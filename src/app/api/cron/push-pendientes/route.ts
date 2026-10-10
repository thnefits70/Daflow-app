import { NextRequest, NextResponse } from "next/server";
import { getAllPendingTasksActors, getPendingTasksForActor, MANDATORY_PUSH_TYPES } from "@/lib/pendingTasks";
import { getDisabledTypes } from "@/lib/pushPreferences";
import { getDuePersonalReminderPushes } from "@/lib/periodicReminders";
import { getStalePurchaseRequestPushes } from "@/lib/purchases";
import { getPurchaseClaimFollowupPushes } from "@/lib/purchaseClaimFollowup";
import { getStaleSupplierCreditPushes } from "@/lib/supplierCredits";
import { getStaleAdminPaymentPushes } from "@/lib/adminPayments";
import { getStalePersonalPurchaseTransferPushes } from "@/lib/personalPurchases";
import { getWeeklyCheckinPushes, getMidweekFollowupPushes } from "@/lib/weeklyCheckin";
import { getDeliveryOverduePushes, getContraEntregaPaymentOverduePushes } from "@/lib/externalSales";
import { getExpiringLotPushes } from "@/lib/stockKardex";
import { sendPushToOwner } from "@/lib/webPush";
import { sendSupplierShippingDailyReminders } from "@/lib/supplierShippingPush";
import { runNichoAutoBackfill } from "@/lib/nichoAi";
import { runInventoryAutoFlows } from "@/lib/inventoryAutoFlows";
import { getPurchaseSuggestionPushes } from "@/lib/purchaseSuggestions";
import { getRepurchaseReminderPushes } from "@/lib/repurchaseReviews";
import { detectSuddenDemand, SUDDEN_DEMAND_PENDING_TYPE } from "@/lib/suddenDemand";

// Estos tienen su propio aviso (Qué comprar a las 8:00; Producto que despierta
// en el momento en que se detecta), no se repiten en el resumen diario.
const PURCHASE_SUGGESTION_TYPES = new Set(["compras_calientes", "compras_frias", "compras_urgentes_sin_atender", SUDDEN_DEMAND_PENDING_TYPE, "recompras_por_aprobar", "recompras_sin_respuesta",
  // Reclamos al proveedor: aviso propio a quien compró (más abajo).
  "compras_urgentes_sin_resolver", "compras_reposicion_seguimiento"]);

// Disparado por Vercel Cron (ver vercel.json) una vez al día. Protegido por
// CRON_SECRET para que nadie más pueda llamarlo desde afuera y disparar
// notificaciones falsas. Confirmado 2026-07-28: si el pendiente sigue sin
// resolverse, se vuelve a avisar al día siguiente (no hay "ya te avisé, no
// insisto más") — mismo espíritu que un recordatorio real, no spam.
//
// Limitación conocida del plan Hobby de Vercel: los crons solo corren una
// vez al día, así que los "Recordatorios" personales con hora específica
// (timeOfDay) se avisan una sola vez por día si ya están vencidos, sin
// respetar la hora exacta configurada — para eso haría falta un plan de
// pago con crons más frecuentes.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  // Confirmado 2026-09-23: antes de armar los pendientes, cierra solo todo
  // lo que ya no necesita a nadie (mercadería que vuelve a INVESTOCK,
  // semanas de dañados terminadas, reclamos aprobados) — ver
  // inventoryAutoFlows.ts.
  await runInventoryAutoFlows();

  // Pedido del usuario 2026-10-02: los domingos no se trabaja, así que el
  // barrido de las 8:00 no le manda avisos a nadie (ni los obligatorios).
  // Lo pendiente sigue en Inicio y se avisa el lunes. Los avisos que nacen
  // porque alguien hizo algo en DAFLOW ese día sí salen (ese no es este
  // barrido). El trabajo de fondo sin avisos sigue corriendo.
  if (new Date().toLocaleDateString("en-US", { weekday: "short", timeZone: "America/Guayaquil" }) === "Sun") {
    const nichoBackfill = await runNichoAutoBackfill();
    return NextResponse.json({ ok: true, sunday: true, notified: 0, nichoBackfill });
  }

  // Producto que despierta: normalmente se detecta al subir el manifiesto;
  // esto es el respaldo por si esa revisión falló.
  await detectSuddenDemand().catch(() => null);

  const actors = await getAllPendingTasksActors();
  let notified = 0;

  for (const { ownerId, actor } of actors) {
    const tasks = await getPendingTasksForActor(actor);
    if (!tasks || tasks.items.length === 0) continue;

    // Confirmado 2026-07-28: cada quien puede apagar tipos puntuales de
    // pendiente (ej. "Pagos recordatorios" sí, "Roles de pago" no) — se
    // filtra aquí, no en getPendingTasksForActor, porque la tarjeta de
    // Pendientes dentro de DAFLOW debe seguir mostrando todo siempre; la
    // preferencia solo decide qué se manda como notificación externa.
    const disabled = await getDisabledTypes(ownerId);
    // "Qué comprar" tiene su propio aviso con el detalle (más abajo), no se
    // repite en este resumen.
    const notifiable = tasks.items.filter((i) => !PURCHASE_SUGGESTION_TYPES.has(i.type) && (MANDATORY_PUSH_TYPES.has(i.type) || !disabled.has(i.type)));
    if (notifiable.length === 0) continue;

    const first = notifiable[0];
    const body =
      notifiable.length === 1
        ? `${first.label} — ${first.meta}`
        : `${first.label} — ${first.meta} (+${notifiable.length - 1} más)`;

    await sendPushToOwner(ownerId, {
      title: `DAFLOW · ${tasks.title}`,
      body,
      url: first.href,
    });
    notified++;
  }

  // Qué comprar (confirmado 2026-09-29, idea de Daniel): resumen diario de
  // compras calientes a Jariel, frías a Nairoby, y a Daniel los urgentes que
  // llevan 3+ días sin comprarse.
  for (const r of await getPurchaseSuggestionPushes()) {
    if ((await getDisabledTypes(r.ownerId)).has(r.type)) continue;
    await sendPushToOwner(r.ownerId, { title: r.title, body: r.body, url: r.url });
    notified++;
  }

  // Recompras (pedido del usuario 2026-10-06): a Bryan lo que espera su
  // decisión; a quien envió una RC sin respuesta, que hable con él en persona.
  for (const r of await getRepurchaseReminderPushes()) {
    await sendPushToOwner(r.ownerId, { title: r.title, body: r.body, url: r.url });
    notified++;
  }

  const personalReminders = await getDuePersonalReminderPushes();
  for (const r of personalReminders) {
    await sendPushToOwner(r.ownerId, { title: r.title, body: r.body, url: r.url });
    notified++;
  }

  const stalePurchases = await getStalePurchaseRequestPushes();
  for (const r of stalePurchases) {
    await sendPushToOwner(r.ownerId, { title: r.title, body: r.body, url: r.url });
    notified++;
  }

  // Reclamos al proveedor (pedido del usuario 2026-10-10): a quien hizo la
  // compra, cada día que un reclamo lleve 2+ días sin gestión o una
  // reposición esté vencida / sin fecha y el proveedor no la haya enviado.
  for (const r of await getPurchaseClaimFollowupPushes()) {
    await sendPushToOwner(r.ownerId, { title: r.title, body: r.body, url: r.url });
    notified++;
  }

  const staleCredits = await getStaleSupplierCreditPushes();
  for (const r of staleCredits) {
    await sendPushToOwner(r.ownerId, { title: r.title, body: r.body, url: r.url });
    notified++;
  }

  const staleAdminPayments = await getStaleAdminPaymentPushes();
  for (const r of staleAdminPayments) {
    await sendPushToOwner(r.ownerId, { title: r.title, body: r.body, url: r.url });
    notified++;
  }

  const stalePersonalPurchaseTransfers = await getStalePersonalPurchaseTransferPushes();
  for (const r of stalePersonalPurchaseTransfers) {
    await sendPushToOwner(r.ownerId, { title: r.title, body: r.body, url: r.url });
    notified++;
  }

  // 2026-10-01: ya no se recuerda leer ATOM — los combos salen solos de
  // los cortes (pedido del usuario).

  // Check-in semanal — reemplaza la reunión 1:1: solo se activa los
  // viernes (ver getWeeklyCheckinPushes), a todo colaborador activo de un
  // área con trackWeeklyReview que todavía no reportó esta semana.
  const weeklyCheckinPushes = await getWeeklyCheckinPushes();
  for (const r of weeklyCheckinPushes) {
    await sendPushToOwner(r.ownerId, { title: r.title, body: r.body, url: r.url });
    notified++;
  }

  // Seguimiento de mitad de semana (miércoles) — no espera al viernes para
  // recordarle a cada líder el plan que dejó pendiente (ver
  // getMidweekFollowupPushes).
  const midweekFollowupPushes = await getMidweekFollowupPushes();
  for (const r of midweekFollowupPushes) {
    await sendPushToOwner(r.ownerId, { title: r.title, body: r.body, url: r.url });
    notified++;
  }

  // Ventas Externas — alertas de tiempo (Parte 3): 3 días hábiles sin
  // cerrar desde la entrega, y 48 horas sin comprobante en contra entrega.
  const externalSaleTimingPushes = [...(await getDeliveryOverduePushes()), ...(await getContraEntregaPaymentOverduePushes())];
  for (const r of externalSaleTimingPushes) {
    await sendPushToOwner(r.ownerId, { title: r.title, body: r.body, url: r.url });
    notified++;
  }

  // Lotes de caducidad — aviso al líder de Inventario cuando falten 6 meses
  // o menos para vencer (confirmado 2026-09-10, pedido de Daniel).
  const expiringLotPushes = await getExpiringLotPushes();
  for (const r of expiringLotPushes) {
    await sendPushToOwner(r.ownerId, { title: r.title, body: r.body, url: r.url });
    notified++;
  }

  // Equipo de despacho de CHEN (confirmado 2026-09-23) — recordatorio
  // diario de cuántos pedidos les quedan por enviar, solo si activaron
  // avisos en el enlace "solo envíos" y queda algo pendiente.
  notified += await sendSupplierShippingDailyReminders();

  // Backfill automático de nichos faltantes (confirmado 2026-09-02) — corre
  // solo mientras el gasto del mes para esta feature no llegue al techo; si
  // ya lo alcanzó, se detiene y se queda esperando confirmación manual desde
  // el botón "Sugerir nichos faltantes" en Base de datos de productos.
  const nichoBackfill = await runNichoAutoBackfill();

  return NextResponse.json({ ok: true, checked: actors.length, notified, nichoBackfill });
}
