import { pvxShareImage, SHARE_IMAGE_SIZE } from "@/lib/pvxShareImage";

export const size = SHARE_IMAGE_SIZE;
export const contentType = "image/png";
export const alt = "Michelle IA, la asistente virtual de Provedix";

export default function Image() {
  return pvxShareImage({ kicker: "Asistente virtual · IA", title: "Pregúntale a Michelle IA", subtitle: "Productos ganadores, el estado de tus guías y tus dudas sobre Provedix, al instante." });
}
