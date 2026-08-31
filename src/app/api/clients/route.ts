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

const createSchema = z.object({
  name: z.string().trim().min(1, "Falta el nombre del cliente."),
  idType: z.enum(["RUC", "CEDULA"]),
  idNumber: z.string().trim().min(1, "Falta el RUC o cédula del cliente."),
  phone: z.string().trim().min(1, "Falta el celular del cliente."),
  address: z.string().trim().min(1, "Falta la dirección referencial del cliente."),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canDeclareExternalSales()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  // Chequeo de exactitud del lado del servidor — el frontend ya avisa antes
  // de llegar aquí, pero esto es lo que de verdad evita el duplicado.
  const existing = await prisma.client.findUnique({ where: { idNumber: parsed.data.idNumber } });
  if (existing) {
    return NextResponse.json(
      { error: `Ya existe un cliente registrado con ese ${parsed.data.idType === "RUC" ? "RUC" : "cédula"} — selecciónalo en vez de crear uno nuevo.`, existingClient: existing },
      { status: 409 }
    );
  }

  const isAdmin = session.user.role === "admin";
  const client = await prisma.client.create({
    data: {
      name: parsed.data.name,
      idType: parsed.data.idType,
      idNumber: parsed.data.idNumber,
      phone: parsed.data.phone,
      address: parsed.data.address,
      createdById: isAdmin ? null : session.user.id,
    },
  });
  return NextResponse.json(client, { status: 201 });
}
