import { Resend } from "resend";

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
