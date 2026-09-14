import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canDeclareExternalSales } from "@/lib/guards";

export async function GET() {
  const session = await auth();
  if (!(await canDeclareExternalSales()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const clients = await prisma.client.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json(clients);
}

// Confirmado 2026-09-14, pedido explícito del usuario: la mayoría de los
// clientes no da cédula/RUC — dejó de ser obligatorio (ver Client.idNumber
// en schema.prisma). idType solo tiene sentido si hay idNumber, así que
// ambos se validan juntos más abajo.
const createSchema = z.object({
  name: z.string().trim().min(1, "Falta el nombre del cliente."),
  idType: z.enum(["RUC", "CEDULA"]).optional(),
  idNumber: z.string().trim().optional(),
  phone: z.string().trim().min(1, "Falta el celular del cliente."),
  email: z.string().trim().email("El correo no tiene un formato válido.").optional().or(z.literal("")),
  address: z.string().trim().min(1, "Falta la dirección referencial del cliente."),
  country: z.string().trim().optional(),
  city: z.string().trim().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canDeclareExternalSales()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const idNumber = parsed.data.idNumber?.trim() || null;
  const idType = idNumber ? (parsed.data.idType ?? "CEDULA") : null;

  // Chequeo de exactitud del lado del servidor — el frontend ya avisa antes
  // de llegar aquí, pero esto es lo que de verdad evita el duplicado. Sin
  // idNumber no hay nada que chequear (varios clientes sin cédula/RUC
  // pueden coexistir, Postgres no choca NULL contra NULL).
  if (idNumber) {
    const existing = await prisma.client.findUnique({ where: { idNumber } });
    if (existing) {
      return NextResponse.json(
        { error: `Ya existe un cliente registrado con ese ${idType === "RUC" ? "RUC" : "cédula"} — selecciónalo en vez de crear uno nuevo.`, existingClient: existing },
        { status: 409 }
      );
    }
  }

  const isAdmin = session.user.role === "admin";
  const client = await prisma.client.create({
    data: {
      name: parsed.data.name,
      idType,
      idNumber,
      phone: parsed.data.phone,
      email: parsed.data.email || null,
      address: parsed.data.address,
      country: parsed.data.country || null,
      city: parsed.data.city || null,
      createdById: isAdmin ? null : session.user.id,
    },
  });
  return NextResponse.json(client, { status: 201 });
}
