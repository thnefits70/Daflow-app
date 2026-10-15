import { readFile } from "fs/promises";
import { join } from "path";
import { ImageResponse } from "next/og";

// Imagen de vista previa al compartir un enlace de provedix.com por WhatsApp,
// Facebook, etc. (pedido del usuario 2026-10-15): fondo oscuro, logo y el
// mensaje de la herramienta. Sin nada de DAFLOW.
export const SHARE_IMAGE_SIZE = { width: 1200, height: 630 };

export async function pvxShareImage({ kicker, title, subtitle }: { kicker: string; title: string; subtitle: string }) {
  const logo = await readFile(join(process.cwd(), "public/pvx/brand/wordmark-white.png"));
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 72px", background: "#0d0e11", color: "#fff" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoSrc} alt="" width={320} height={60} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 30, fontWeight: 700, color: "#F95B02", letterSpacing: 2, textTransform: "uppercase" }}>{kicker}</div>
          <div style={{ marginTop: 14, fontSize: 76, fontWeight: 900, lineHeight: 1.05, maxWidth: 1000 }}>{title}</div>
          <div style={{ marginTop: 22, fontSize: 32, color: "rgba(255,255,255,0.75)", maxWidth: 980 }}>{subtitle}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ background: "#F95B02", color: "#fff", fontSize: 30, fontWeight: 800, padding: "14px 30px", borderRadius: 999 }}>provedix.com</div>
          <div style={{ fontSize: 26, color: "rgba(255,255,255,0.6)" }}>Proveedor verificado de Dropi en Ecuador</div>
        </div>
      </div>
    ),
    SHARE_IMAGE_SIZE,
  );
}
