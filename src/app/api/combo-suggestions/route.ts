import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canViewComboSuggestions } from "@/lib/guards";
import type { ComboSuggestionStatus } from "@/generated/prisma/client";

const CATALOG_SELECT = { id: true, name: true, photos: true, nicho: true } as const;
const VALID_STATUSES: ComboSuggestionStatus[] = ["SUGERIDO", "SELECCIONADO", "PENDIENTE_APROBACION", "APROBADO", "RECHAZADO", "CREADO_EN_DROPI"];

export async function GET(req: NextRequest) {
  if (!(await canViewComboSuggestions())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const statusParam = req.nextUrl.searchParams.get("status");
  const status = statusParam && VALID_STATUSES.includes(statusParam as ComboSuggestionStatus) ? (statusParam as ComboSuggestionStatus) : null;
  const suggestions = await prisma.comboSuggestion.findMany({
    where: status ? { status } : undefined,
    orderBy: { generatedAt: "desc" },
    include: {
      winnerCatalogItem: { select: CATALOG_SELECT },
      lowRotationCatalogItem: { select: CATALOG_SELECT },
      selectedBy: { select: { name: true } },
      reviewedBy: { select: { name: true } },
      createdInDropiBy: { select: { name: true } },
    },
  });
  return NextResponse.json({ suggestions });
}
