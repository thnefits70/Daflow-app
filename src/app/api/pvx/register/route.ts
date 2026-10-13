import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { normalizeWhatsapp, signLead } from "@/lib/provedixPublic";
import { readVisitor, registerAllowed, setVisitorCookies } from "@/lib/provedixVisitor";
import { checkWhatsapp } from "@/lib/pvxPhone";

// Registro en provedix.com: nombre + WhatsApp + aceptación (obligatoria).
// "website" es un campo oculto: si viene lleno es un robot y se ignora.
const schema = z.object({
  name: z.string().trim().min(2, "Escribe tu nombre.").max(80),
  // País obligatorio (idea de Daniel 2026-10-13): el número se revisa con
  // las reglas de celular de ese país (pvxPhone.ts).
  country: z.string().trim().length(2, "Elige el país de tu WhatsApp."),
  whatsapp: z.string().trim().min(6, "Escribe tu WhatsApp.").max(24),
  consent: z.literal(true, { message: "Acepta recibir los productos ganadores para continuar." }),
  website: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Revisa tus datos." }, { status: 400 });
  if (parsed.data.website) return NextResponse.json({ ok: true });
  if (!(await registerAllowed(req))) return NextResponse.json({ error: "Hay muchos registros en este momento. Intenta de nuevo en unos minutos." }, { status: 429 });

  const checked = checkWhatsapp(parsed.data.country, parsed.data.whatsapp);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  // Se guarda igual que antes (Ecuador 09…, otro país +<prefijo>…) para que
  // siga cuadrando con los registros viejos y con los celulares de las guías.
  const whatsapp = normalizeWhatsapp(checked.full);
  if (!whatsapp) return NextResponse.json({ error: "Ese WhatsApp no es válido." }, { status: 400 });
  const name = parsed.data.name.replace(/\s+/g, " ");

  const { visitorId } = await readVisitor(req);
  const now = new Date();
  // Mismo WhatsApp otra vez (otro celular, borró las cookies): es la misma
  // persona, se actualiza su nombre y se le vuelve a abrir la página.
  const lead = await prisma.provedixLead.upsert({
    where: { whatsapp },
    create: { name, whatsapp, consentAt: now },
    update: { name, consentAt: now, lastSeenAt: now },
    select: { id: true, name: true },
  });
  // Lo que miró antes de registrarse también queda a su nombre.
  await prisma.provedixEvent.updateMany({ where: { visitorId, leadId: null }, data: { leadId: lead.id } }).catch(() => null);

  const res = NextResponse.json({ ok: true, name: lead.name });
  setVisitorCookies(res, visitorId, signLead(lead.id));
  return res;
}
