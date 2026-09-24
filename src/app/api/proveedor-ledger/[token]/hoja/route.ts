import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { findSupplierByPublicSheetToken } from "@/lib/supplierDebt";
import { getSheetViewer } from "@/lib/supplierSheetAccess";
import { SHEET_MAX_COLS, SHEET_MAX_ROWS } from "@/lib/supplierSheet";
import { loadAutoOrdersTab } from "@/lib/supplierSheetAuto";

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
  }),
  z.object({ t: z.literal("addTab"), name: z.string().trim().min(1).max(60) }),
  z.object({ t: z.literal("renameTab"), tabId: z.string().min(1), name: z.string().trim().min(1).max(60) }),
  z.object({ t: z.literal("deleteTab"), tabId: z.string().min(1) }),
  z.object({ t: z.literal("colWidth"), tabId: z.string().min(1), c: z.number().int().min(0).max(SHEET_MAX_COLS - 1), w: z.number().int().min(30).max(800) }),
]);

const bodySchema = z.object({ ops: z.array(opSchema).min(1).max(5000) });

const SIDE_LABEL = { SUPPLIER: "el equipo del proveedor", OWN: "nuestro equipo" } as const;

async function loadSheet(supplierId: string) {
  const include = { cells: { select: { row: true, col: true, value: true, style: true, authorSide: true, authorEmail: true } } } as const;
  const orderBy = [{ position: "asc" as const }, { createdAt: "asc" as const }];
  let tabs = await prisma.supplierSheetTab.findMany({ where: { supplierId }, orderBy, include });
  if (tabs.length === 0) {
    await prisma.supplierSheetTab.create({ data: { supplierId, name: "Hoja 1", position: 0 } });
    tabs = await prisma.supplierSheetTab.findMany({ where: { supplierId }, orderBy, include });
  }
  return tabs.map((t) => ({
    id: t.id,
    name: t.name,
    colWidths: (t.colWidths as Record<string, number> | null) ?? {},
    locked: t.locked,
    createdBySide: t.createdBySide,
    cells: t.cells.map((c) => ({ r: c.row, c: c.col, v: c.value, s: c.style ?? null, a: c.authorSide, e: c.authorEmail })),
  }));
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supplier = await resolveSupplier(token);
  if (!supplier) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  const viewer = await getSheetViewer(supplier.id);
  if (!viewer) return NextResponse.json({ error: "Tu sesión terminó. Vuelve a entrar con tu correo." }, { status: 401 });
  return NextResponse.json(
    // Confirmado 2026-09-24: la hoja "Pedidos" (fotos de lo pedido, la llena
    // DAFLOW sola, ver supplierSheetAuto.ts) va primero, con candado.
    { tabs: [await loadAutoOrdersTab(supplier.id), ...(await loadSheet(supplier.id))], canWrite: viewer.canWrite, side: viewer.side },
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
    select: { id: true, position: true, locked: true, createdBySide: true },
  });
  // Solo las hojas libres se pueden tocar desde el enlace.
  const freeTabs = new Map(allTabs.filter((t) => !t.locked).map((t) => [t.id, t]));
  let nextPosition = allTabs.reduce((m, t) => Math.max(m, t.position), -1) + 1;
  const createdTabIds: string[] = [];
  const rejected: string[] = [];

  // Estado actual de las celdas que se van a tocar (quién las escribió).
  const touchedTabIds = [...new Set(parsed.data.ops.flatMap((o) => (o.t === "set" ? [o.tabId] : [])))].filter((id) => freeTabs.has(id));
  const existingRows = touchedTabIds.length
    ? await prisma.supplierSheetCell.findMany({
        where: { tabId: { in: touchedTabIds } },
        select: { tabId: true, row: true, col: true, value: true, style: true, authorSide: true },
      })
    : [];
  const existing = new Map(existingRows.map((c) => [`${c.tabId}:${c.row}:${c.col}`, c]));
  const logs: Prisma.SupplierSheetCellLogCreateManyInput[] = [];

  for (const op of parsed.data.ops) {
    if (op.t === "addTab") {
      const tab = await prisma.supplierSheetTab.create({
        data: { supplierId: supplier.id, name: op.name, position: nextPosition++, createdBySide: viewer.side },
      });
      freeTabs.set(tab.id, { id: tab.id, position: tab.position, locked: false, createdBySide: viewer.side });
      createdTabIds.push(tab.id);
      continue;
    }
    const tab = freeTabs.get(op.tabId);
    if (!tab) continue;

    if (op.t === "set") {
      const key = `${op.tabId}:${op.r}:${op.c}`;
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
    } else if (op.t === "renameTab" || op.t === "deleteTab") {
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

  return NextResponse.json({
    ok: true,
    createdTabIds,
    rejected,
    rejectedMessage: rejected.length ? `No se puede cambiar lo que escribió ${SIDE_LABEL[viewer.side === "OWN" ? "SUPPLIER" : "OWN"]}.` : undefined,
  });
}
