// El número de guía se cruza con el archivo del corte, así que solo puede ser
// el número. Caso Michelle 2026-10-15: escribió la descripción en esa casilla
// ("745673494 GUIAS/R APROBADA, PICADOR…") y salió todo pegado. Si hay
// palabras después de un espacio o signos (/ , .), lo rechazamos.
export function warrantyGuideNumberError(raw: string): string | null {
  const text = raw.trim();
  if (text.length < 3) return "Escribe el número de guía.";
  const words = text.split(/\s+/);
  const extraWords = words.slice(1).some((w) => /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(w));
  if (extraWords || !/^[A-Za-z0-9\s-]+$/.test(text) || text.replace(/\s+/g, "").length > 30) {
    return "En \"Número de guía\" va solo el número (ej.: 745673494). La descripción escríbela en Comentario.";
  }
  return null;
}
