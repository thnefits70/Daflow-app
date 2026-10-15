import { pvxShareImage, SHARE_IMAGE_SIZE } from "@/lib/pvxShareImage";

export const size = SHARE_IMAGE_SIZE;
export const contentType = "image/png";
export const alt = "Calculadora de ganancia gratis de Provedix";

export default function Image() {
  return pvxShareImage({ kicker: "Calculadora gratis", title: "¿A cuánto lo vendo para ganar?", subtitle: "Tu precio rentable, cuánto puedes pagar de publicidad y tus combos, en segundos." });
}
