import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { findSupplierByPublicSheetToken } from "@/lib/supplierDebt";
import { getSheetViewer } from "@/lib/supplierSheetAccess";
import { SHEET_MAX_COLS, SHEET_MAX_ROWS } from "@/lib/supplierSheet";
import { AUTO_ORDERS_COLS, autoTabRowKeys, ensureAutoOrdersTabs, isAutoOrdersTabId, mergeAutoOrders } from "@/lib/supplierSheetAuto";
import { recordSupplierSheetNote } from "@/lib/supplierSheetNotes";

// Confirmado 2026-09-24, pedido explícito del usuario: la hoja de cálculo en
// línea del equipo de CHEN. Sin auth() a propósito (no tienen cuenta) — el
// acceso es SOLO por el token de la hoja (publicSheetToken), que nunca abre
// el saldo ni los envíos. Se guarda celda por celda (no la hoja entera) para
// que dos personas escribiendo a la vez no se borren lo del otro.
// Confirmado 2026-09-24: además del token, exige sesión de un correo de la
// lista del admin (getSheetViewer). Las hojas con candado (locked) las llena
// DAFLOW sola — nadie de CHEN las puede cambiar, renombrar ni borrar.

async function resolveSupplier(token: string) {
  const supplier = await findSupplierByPublicSheetToken(token);
  if (!supplier || supplier.paymentMode !== "CREDITO") return null;
  return supplier;
}

const styleSchema = z
  .object({
    b: z.boolean().optional(),
    i: z.boolean().optional(),
    u: z.boolean().optional(),
    st: z.boolean().optional(),
    fc: z.string().max(20).optional(),
    bg: z.string().max(20).optional(),
    al: z.enum(["left", "center", "right"]).optional(),
    fs: z.number().int().min(6).max(48).optional(),
    fmt: z.enum(["currency", "percent", "number"]).optional(),
    dp: z.number().int().min(0).max(10).optional(),
  })
  .nullable();

const opSchema = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("set"),
    tabId: z.string().min(1),
    r: z.number().int().min(0).max(SHEET_MAX_ROWS - 1),
    c: z.number().int().min(0).max(SHEET_MAX_COLS - 1),
    v: z.string().max(10000),
    s: styleSchema,
    // Pestañas automáticas: a qué pedido/pago pertenece la fila (rowKey).
    k: z.string().max(80).optional(),
  }),
  z.object({ t: z.literal("addTab"), name: z.string().trim().min(1).max(60) }),
  z.object({ t: z.literal("renameTab"), tabId: z.string().min(1), name: z.string().trim().min(1).max(60) }),
  z.object({ t: z.literal("deleteTab"), tabId: z.string().min(1) }),
  z.object({ t: z.literal("colWidth"), tabId: z.string().min(1), c: z.number().int().min(0).max(SHEET_MAX_COLS - 1), w: z.number().int().min(30).max(800) }),
]);

const bodySchema = z.object({ ops: z.array(opSchema).min(1).max(5000) });

const AUTO_MSG = "Esa información se carga automáticamente — no se puede cambiar ni borrar.";
const NO_ROW_MSG = "En esta hoja se escribe al lado de un pedido o de un pago. Para notas generales usa la hoja libre.";
const SIDE_LABEL = { SUPPLIER: "el equipo del proveedor", OWN: "nuestro equipo" } as const;

async function loadSheet(supplierId: string) {
  const include = {
    cells: { select: { row: true, col: true, value: true, style: true, authorSide: true, authorEmail: true } },
    anchoredCells: { select: { rowKey: true, col: true, value: true, style: true, authorSide: true, authorEmail: true } },
  } as const;
  const orderBy = [{ position: "asc" as const }, { createdAt: "asc" as const }];
  let tabs = await prisma.supplierSheetTab.findMany({ where: { supplierId }, orderBy, include });
  if (tabs.length === 0) {
    await prisma.supplierSheetTab.create({ data: { supplierId, name: "Hoja 1", position: 0 } });
    tabs = await prisma.supplierSheetTab.findMany({ where: { supplierId }, orderBy, include });
  }
  // Confirmado 2026-09-24: una pestaña "Pedidos <mes> <año>" por mes (ver
  // supplierSheetAuto.ts), siempre primero; al empezar un mes nuevo aparece
  // sola. Lo automático se pone encima en cada carga.
  if (await ensureAutoOrdersTabs(supplierId, tabs)) {
    tabs = await prisma.supplierSheetTab.findMany({ where: { supplierId }, orderBy, include });
  }
  const mapped = tabs.map((t) => ({
    id: t.id,
    name: t.name,
    colWidths: (t.colWidths as Record<string, number> | null) ?? {},
    locked: t.locked,
    createdBySide: t.createdBySide,
    cells: t.cells.map((c) => ({ r: c.row, c: c.col, v: c.value, s: c.style ?? null, a: c.authorSide, e: c.authorEmail })),
  }));
  return Promise.all(
    mapped.map((t, i) =>
      isAutoOrdersTabId(t.id) ? mergeAutoOrders(supplierId, { ...t, cells: [] }, tabs[i].anchoredCells) : t,
    ),
  );
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supplier = await resolveSupplier(token);
  if (!supplier) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  const viewer = await getSheetViewer(supplier.id);
  if (!viewer) return NextResponse.json({ error: "Tu sesión terminó. Vuelve a entrar con tu correo." }, { status: 401 });
  return NextResponse.json(
    { tabs: await loadSheet(supplier.id), canWrite: viewer.canWrite, side: viewer.side },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// Confirmado 2026-09-24, pedido explícito del usuario (antifraude): una celda
// escrita por un lado (equipo del proveedor / nuestro equipo) NUNCA la puede
// cambiar, borrar ni reformatear el otro lado — ej. si quedó "100 almohadas a
// $3", nadie del otro lado la puede pasar a $5. Las hojas con candado no las
// toca nadie desde el enlace. Cada cambio aceptado queda en
// SupplierSheetCellLog (quién, cuándo, antes y después).
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supplier = await resolveSupplier(token);
  if (!supplier) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  const viewer = await getSheetViewer(supplier.id);
  if (!viewer) return NextResponse.json({ error: "Tu sesión terminó. Vuelve a entrar con tu correo." }, { status: 401 });
  if (!viewer.canWrite) return NextResponse.json({ error: "Tu correo solo tiene permiso para ver." }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const allTabs = await prisma.supplierSheetTab.findMany({
    where: { supplierId: supplier.id },
    select: { id: true, name: true, position: true, locked: true, createdBySide: true },
  });
  const tabNames = new Map(allTabs.map((t) => [t.id, t.name]));
  // Solo las hojas libres se pueden tocar desde el enlace.
  const freeTabs = new Map(allTabs.filter((t) => !t.locked).map((t) => [t.id, t]));
  let nextPosition = allTabs.reduce((m, t) => Math.max(m, t.position), -1) + 1;
  const createdTabIds: string[] = [];
  const rejected: string[] = [];
  // Celdas que carga DAFLOW sola (pestaña "Pedidos"): no las cambia nadie.
  let rejectedAuto = 0;
  let rejectedNoRow = 0;
  // Notas de CHEN para avisar a quien corresponda (después de responder).
  const notes: { tabId: string; rowKey: string | null; row: number; col: number; text: string }[] = [];

  // Estado actual de las celdas que se van a tocar (quién las escribió).
  const touchedTabIds = [...new Set(parsed.data.ops.flatMap((o) => (o.t === "set" ? [o.tabId] : [])))].filter((id) => freeTabs.has(id));
  const existingRows = touchedTabIds.length
    ? await prisma.supplierSheetCell.findMany({
        where: { tabId: { in: touchedTabIds } },
        select: { tabId: true, row: true, col: true, value: true, style: true, authorSide: true },
      })
    : [];
  const existing = new Map(existingRows.map((c) => [`${c.tabId}:${c.row}:${c.col}`, c]));
  // Pestañas automáticas: lo escrito va amarrado al pedido/pago (rowKey).
  const autoTabIds = touchedTabIds.filter(isAutoOrdersTabId);
  const anchoredRows = autoTabIds.length
    ? await prisma.supplierSheetAnchoredCell.findMany({
        where: { tabId: { in: autoTabIds } },
        select: { tabId: true, rowKey: true, col: true, value: true, style: true, authorSide: true },
      })
    : [];
  const anchored = new Map(anchoredRows.map((c) => [`${c.tabId}|${c.rowKey}|${c.col}`, c]));
  const validRowKeys = new Map<string, Set<string>>();
  for (const id of autoTabIds) validRowKeys.set(id, await autoTabRowKeys(supplier.id, id));
  const logs: Prisma.SupplierSheetCellLogCreateManyInput[] = [];

  for (const op of parsed.data.ops) {
    if (op.t === "addTab") {
      const tab = await prisma.supplierSheetTab.create({
        data: { supplierId: supplier.id, name: op.name, position: nextPosition++, createdBySide: viewer.side },
      });
      freeTabs.set(tab.id, { id: tab.id, name: tab.name, position: tab.position, locked: false, createdBySide: viewer.side });
      tabNames.set(tab.id, tab.name);
      createdTabIds.push(tab.id);
      continue;
    }
    const tab = freeTabs.get(op.tabId);
    if (!tab) continue;

    if (op.t === "set") {
      const key = `${op.tabId}:${op.r}:${op.c}`;
      if (isAutoOrdersTabId(op.tabId) && AUTO_ORDERS_COLS.includes(op.c)) {
        rejectedAuto++;
        continue;
      }
      if (isAutoOrdersTabId(op.tabId)) {
        if (!op.k || !validRowKeys.get(op.tabId)?.has(op.k)) {
          rejectedNoRow++;
          continue;
        }
        const akey = `${op.tabId}|${op.k}|${op.c}`;
        const acur = anchored.get(akey);
        if (acur?.authorSide && acur.authorSide !== viewer.side) {
          rejected.push(akey);
          continue;
        }
        const astyle = op.s && Object.keys(op.s).length > 0 ? op.s : null;
        const aempty = op.v === "" && !astyle;
        if (acur && acur.value === op.v && JSON.stringify(acur.style ?? null) === JSON.stringify(astyle)) continue;
        if (!acur && aempty) continue;
        if (aempty) {
          await prisma.supplierSheetAnchoredCell.deleteMany({ where: { tabId: op.tabId, rowKey: op.k, col: op.c } });
          anchored.delete(akey);
        } else {
          await prisma.supplierSheetAnchoredCell.upsert({
            where: { tabId_rowKey_col: { tabId: op.tabId, rowKey: op.k, col: op.c } },
            create: { tabId: op.tabId, rowKey: op.k, col: op.c, value: op.v, style: astyle ?? undefined, authorSide: viewer.side, authorEmail: viewer.email },
            update: { value: op.v, style: astyle ?? Prisma.DbNull, authorSide: viewer.side, authorEmail: viewer.email },
          });
          anchored.set(akey, { tabId: op.tabId, rowKey: op.k, col: op.c, value: op.v, style: astyle as Prisma.JsonValue, authorSide: viewer.side });
        }
        logs.push({
          tabId: op.tabId,
          row: op.r,
          col: op.c,
          rowKey: op.k,
          oldValue: acur?.value ?? null,
          newValue: aempty ? null : op.v,
          oldStyle: (acur?.style as Prisma.InputJsonValue | null) ?? Prisma.DbNull,
          newStyle: (astyle as Prisma.InputJsonValue | null) ?? Prisma.DbNull,
          email: viewer.email,
          side: viewer.side,
        });
        if (viewer.side === "SUPPLIER" && (acur?.value ?? "") !== op.v) notes.push({ tabId: op.tabId, rowKey: op.k, row: op.r, col: op.c, text: op.v });
        continue;
      }
      const cur = existing.get(key);
      if (cur?.authorSide && cur.authorSide !== viewer.side) {
        rejected.push(key);
        continue;
      }
      const style = op.s && Object.keys(op.s).length > 0 ? op.s : null;
      const empty = op.v === "" && !style;
      if (cur && cur.value === op.v && JSON.stringify(cur.style ?? null) === JSON.stringify(style)) continue;
      if (!cur && empty) continue;
      if (empty) {
        await prisma.supplierSheetCell.deleteMany({ where: { tabId: op.tabId, row: op.r, col: op.c } });
        existing.delete(key);
      } else {
        await prisma.supplierSheetCell.upsert({
          where: { tabId_row_col: { tabId: op.tabId, row: op.r, col: op.c } },
          create: { tabId: op.tabId, row: op.r, col: op.c, value: op.v, style: style ?? undefined, authorSide: viewer.side, authorEmail: viewer.email },
          update: { value: op.v, style: style ?? Prisma.DbNull, authorSide: viewer.side, authorEmail: viewer.email },
        });
        existing.set(key, { tabId: op.tabId, row: op.r, col: op.c, value: op.v, style: style as Prisma.JsonValue, authorSide: viewer.side });
      }
      logs.push({
        tabId: op.tabId,
        row: op.r,
        col: op.c,
        oldValue: cur?.value ?? null,
        newValue: empty ? null : op.v,
        oldStyle: (cur?.style as Prisma.InputJsonValue | null) ?? Prisma.DbNull,
        newStyle: (style as Prisma.InputJsonValue | null) ?? Prisma.DbNull,
        email: viewer.email,
        side: viewer.side,
      });
      if (viewer.side === "SUPPLIER" && (cur?.value ?? "") !== op.v) notes.push({ tabId: op.tabId, rowKey: null, row: op.r, col: op.c, text: op.v });
    } else if (op.t === "renameTab" || op.t === "deleteTab") {
      // La pestaña "Pedidos" (automática) no se renombra ni se elimina.
      if (isAutoOrdersTabId(op.tabId)) {
        rejected.push(`tab:${op.tabId}`);
        continue;
      }
      // Solo el lado que creó la hoja la renombra o elimina (null = anterior
      // a este cambio, cualquiera). Nunca se elimina si tiene celdas del otro lado.
      if (tab.createdBySide && tab.createdBySide !== viewer.side) {
        rejected.push(`tab:${op.tabId}`);
        continue;
      }
      if (op.t === "renameTab") {
        await prisma.supplierSheetTab.update({ where: { id: op.tabId }, data: { name: op.name } });
      } else {
        // Siempre queda al menos una hoja libre.
        if (freeTabs.size <= 1) continue;
        const otherSide = await prisma.supplierSheetCell.count({ where: { tabId: op.tabId, authorSide: { not: viewer.side } } });
        if (otherSide > 0) {
          rejected.push(`tab:${op.tabId}`);
          continue;
        }
        await prisma.supplierSheetTab.delete({ where: { id: op.tabId } });
        freeTabs.delete(op.tabId);
      }
    } else if (op.t === "colWidth") {
      const cur = await prisma.supplierSheetTab.findUnique({ where: { id: op.tabId }, select: { colWidths: true } });
      const widths = { ...((cur?.colWidths as Record<string, number> | null) ?? {}), [String(op.c)]: op.w };
      await prisma.supplierSheetTab.update({ where: { id: op.tabId }, data: { colWidths: widths } });
    }
  }

  if (logs.length) await prisma.supplierSheetCellLog.createMany({ data: logs });

  // Confirmado 2026-09-24: cada nota de CHEN aparece en DAFLOW ("Notas de
  // Chen") y avisa a quien corresponde — después de responder, para que la
  // hoja no espere (la IA, cuando hace falta, puede tardar unos segundos).
  if (notes.length) {
    after(async () => {
      for (const n of notes) {
        await recordSupplierSheetNote({ supplierId: supplier.id, tabName: tabNames.get(n.tabId) ?? "Hoja", authorEmail: viewer.email, ...n }).catch((e) =>
          console.error("No se pudo registrar la nota de CHEN:", e),
        );
      }
    });
  }

  return NextResponse.json({
    ok: true,
    createdTabIds,
    rejected: rejectedAuto || rejectedNoRow ? [...rejected, "auto"] : rejected,
    rejectedMessage: rejectedAuto
      ? AUTO_MSG
      : rejectedNoRow
        ? NO_ROW_MSG
        : rejected.length
        ? `No se puede cambiar lo que escribió ${SIDE_LABEL[viewer.side === "OWN" ? "SUPPLIER" : "OWN"]}.`
        : undefined,
  });
}
