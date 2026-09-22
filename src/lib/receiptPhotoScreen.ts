// Confirmado 2026-09-22 (caso SC-017): prefijo que compareReceiptPhotos
// (purchaseAi.ts) antepone a la nota de la IA cuando una foto de recepción
// parece tomada a la pantalla de otro celular. Archivo aparte para que la UI
// lo pueda importar sin arrastrar el cliente de Anthropic.
export const SCREEN_PHOTO_NOTE_PREFIX = "⚠️ Parece foto de una pantalla";

export function isScreenPhotoNote(note: string | null | undefined) {
  return !!note && note.startsWith(SCREEN_PHOTO_NOTE_PREFIX);
}
