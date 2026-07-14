import { Resend } from "resend";

const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export async function sendPayStubEmail(to: string, employeeName: string, month: number, year: number) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey === "tu-resend-api-key") {
    console.error("RESEND_API_KEY no está configurada. No se pudo enviar el aviso de rol de pago.");
    return { ok: false };
  }

  const monthLabel = MONTH_NAMES[month - 1] ?? month;
  const firstName = employeeName.split(" ")[0] || employeeName;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: "DAFLOW <onboarding@resend.dev>",
    to,
    subject: `Tu rol de pago de ${monthLabel} ${year} ya está disponible — DAFLOW`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color:#0B1F3A;">DAFLOW</h2>
        <p>Hola ${firstName},</p>
        <p>Se subió tu comprobante de pago de <strong>${monthLabel} ${year}</strong>. Ya puedes verlo desde la plataforma, en "Roles de pago".</p>
        <p><a href="${baseUrl}/area/roles-de-pago" style="display:inline-block;background:#1E5EFF;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;font-weight:600;">Ver mi rol de pago</a></p>
      </div>
    `,
  });

  if (error) {
    console.error("Error enviando aviso de rol de pago:", error);
    return { ok: false };
  }
  return { ok: true };
}

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey === "tu-resend-api-key") {
    console.error("RESEND_API_KEY no está configurada. No se pudo enviar el correo de recuperación.");
    return { ok: false };
  }

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: "DAFLOW <onboarding@resend.dev>",
    to,
    subject: "Recuperar contraseña de administrador — DAFLOW",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color:#0B1F3A;">DAFLOW</h2>
        <p>Recibimos una solicitud para restablecer la contraseña de administrador de tu plataforma.</p>
        <p><a href="${resetUrl}" style="display:inline-block;background:#1E5EFF;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;font-weight:600;">Restablecer contraseña</a></p>
        <p style="color:#6B7A90;font-size:12px;">Este enlace expira en 30 minutos. Si no solicitaste esto, ignora este correo.</p>
      </div>
    `,
  });

  if (error) {
    console.error("Error enviando correo de recuperación:", error);
    return { ok: false };
  }
  return { ok: true };
}
