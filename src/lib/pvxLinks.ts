// Enlaces fijos de Provedix (2026-10-17): canales de WhatsApp, redes y rastreo
// por transportadora. Michelle IA los da como botón con [[ENLACE:clave]] (pedido
// del usuario: "¿por qué no le diste el link para que se una directamente?").
// Solo estas claves: la IA nunca puede poner un enlace cualquiera. El pie de
// provedix.com y los recursos de rastreo usan esta misma lista.

export const PVX_LINKS = {
  "canal-provedix": { label: "Unirme al canal de Provedix", url: "https://whatsapp.com/channel/0029VbCKi9o2P59fQXV5Hf30" },
  "canal-damian": { label: "Unirme al canal de Importadora Damián", url: "https://whatsapp.com/channel/0029Vb7M5b0FnSzGabyN9016" },
  instagram: { label: "Instagram @provedix.ec", url: "https://www.instagram.com/provedix.ec/" },
  tiktok: { label: "TikTok @provedix.ec", url: "https://www.tiktok.com/@provedix.ec" },
  facebook: { label: "Facebook de Provedix", url: "https://www.facebook.com/share/1FHzeG3XBR/" },
  "rastreo-servientrega": { label: "Rastrear en Servientrega", url: "https://www.servientrega.com.ec/" },
  "rastreo-gintracom": { label: "Rastrear en Gintracom", url: "https://ec.gintracom.site/web/site/tracking" },
  "rastreo-laarcourier": { label: "Rastrear en LaarCourier", url: "https://fenixoper.laarcourier.com/Tracking/Guiacompleta.aspx" },
  "rastreo-urbano": { label: "Rastrear en Urbano", url: "https://www.urbano.com.ec/" },
  "rastreo-veloces": { label: "Rastrear en Veloces", url: "https://tracking.veloces.app/" },
} as const;

export type PvxLinkKey = keyof typeof PVX_LINKS;

const LINK_RE = /\[\[ENLACE:([a-z-]+)\]\]/g;

export const linksOf = (t: string): PvxLinkKey[] =>
  [...new Set([...t.matchAll(LINK_RE)].map((m) => m[1]))].filter((k): k is PvxLinkKey => k in PVX_LINKS).slice(0, 4);

