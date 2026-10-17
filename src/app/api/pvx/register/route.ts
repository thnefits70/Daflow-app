import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { normalizeWhatsapp, signLead } from "@/lib/provedixPublic";
import {
  readVisitor,
  registerAllowed,
  sameOriginRequest,
  setVisitorCookies,
} from "@/lib/provedixVisitor";
import { checkWhatsapp } from "@/lib/pvxPhone";
import { cleanPersonName } from "@/lib/pvxName";

// Registro en provedix.com: nombre + WhatsApp + aceptación (obligatoria).
// "website" es un campo oculto: si viene lleno es un robot y se ignora.
const schema = z.object({
  name: z.string().trim().min(2, "Escribe tu nombre.").max(80),
  // País obligatorio (idea de Daniel 2026-10-13): el número se revisa con
  // las reglas de celular de ese país (pvxPhone.ts).
  country: z.string().trim().length(2, "Elige el país de tu WhatsApp."),
  whatsapp: z.string().trim().min(6, "Escribe tu WhatsApp.").max(24),
  // Pedido del usuario 2026-10-14: tienda y plataforma obligatorias, correo opcional.
  storeName: z
    .string({ message: "Escribe el nombre de tu tienda." })
    .trim()
    .min(2, "Escribe el nombre de tu tienda.")
    .max(80),
  platform: z.enum(["DROPI", "ROCKET", "AMBAS"], {
    message: "Elige dónde vendes: Dropi, Rocket o ambas.",
  }),
  platformEmail: z
    .union([
      z.literal(""),
      z
        .string()
        .trim()
        .toLowerCase()
        .email("Ese correo no es válido.")
        .max(120),
    ])
    .optional(),
  consent: z.literal(true, {
    message: "Acepta recibir los productos ganadores para continuar.",
  }),
  website: z.string().optional(),
  // Milisegundos que tardó en llenar el formulario (2026-10-16): una persona
  // tarda varios segundos; un robot lo envía al instante.
  fillMs: z.number().optional(),
});

export async function POST(req: NextRequest) {
  if (!sameOriginRequest(req))
    return NextResponse.json(
      { error: "Solicitud no permitida." },
      { status: 403 },
    );
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Revisa tus datos." },
      { status: 400 },
    );
  // Robots: campo oculto lleno → se ignora sin avisar.
  if (parsed.data.website) return NextResponse.json({ ok: true });
  // Enviado en menos de 1,5 s (2026-10-16): una persona (aun con autocompletar)
  // tarda más; se le pide reintentar, un robot no lo hace.
  if (parsed.data.fillMs != null && parsed.data.fillMs < 1500)
    return NextResponse.json(
      { error: "Revisa tus datos un segundo y vuelve a pulsar el botón." },
      { status: 429 },
    );
  if (!(await registerAllowed(req)))
    return NextResponse.json(
      {
        error:
          "Hay muchos registros en este momento. Intenta de nuevo en unos minutos.",
      },
      { status: 429 },
    );

  const checked = checkWhatsapp(parsed.data.country, parsed.data.whatsapp);
  if (!checked.ok)
    return NextResponse.json({ error: checked.error }, { status: 400 });
  // Se guarda igual que antes (Ecuador 09…, otro país +<prefijo>…) para que
  // siga cuadrando con los registros viejos y con los celulares de las guías.
  const whatsapp = normalizeWhatsapp(checked.full);
  if (!whatsapp)
    return NextResponse.json(
      { error: "Ese WhatsApp no es válido." },
      { status: 400 },
    );
  const cleanName = cleanPersonName(parsed.data.name);
  if (!cleanName.ok)
    return NextResponse.json({ error: cleanName.error }, { status: 400 });
  const name = cleanName.name;
  const storeName = parsed.data.storeName.replace(/\s+/g, " ");
  const { platform } = parsed.data;
  const platformEmail = parsed.data.platformEmail || null;

  const { visitorId } = await readVisitor(req);
  const now = new Date();
  // Mismo WhatsApp otra vez (otro celular, borró las cookies): se le vuelve
  // a abrir la página. Seguridad (2026-10-14): NO se cambian los datos que ya
  // dio (nombre, tienda, plataforma, correo) — alguien que solo conoce su
  // número no puede reemplazarlos; solo se completan los que faltaban.
  const prev = await prisma.provedixLead.findUnique({
    where: { whatsapp },
    select: { id: true, storeName: true, platform: true, platformEmail: true },
  });
  const lead = prev
    ? await prisma.provedixLead.update({
        where: { id: prev.id },
        data: {
          ...(prev.storeName ? {} : { storeName }),
          ...(prev.platform ? {} : { platform }),
          ...(prev.platformEmail || !platformEmail ? {} : { platformEmail }),
          consentAt: now,
          lastSeenAt: now,
        },
        select: { id: true, name: true },
      })
    : await prisma.provedixLead.create({
        data: {
          name,
          whatsapp,
          storeName,
          platform,
          platformEmail,
          consentAt: now,
        },
        select: { id: true, name: true },
      });
  // Lo que miró antes de registrarse también queda a su nombre.
  await prisma.provedixEvent
    .updateMany({
      where: { visitorId, leadId: null },
      data: { leadId: lead.id },
    })
    .catch(() => null);

  // Se responde con el nombre que escribió ahora, no con el guardado.
  const res = NextResponse.json({ ok: true, name });
  setVisitorCookies(res, visitorId, signLead(lead.id), name);
  return res;
}
