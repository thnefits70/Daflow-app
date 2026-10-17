// Nombre de la persona al registrarse en provedix.com (2026-10-17): en la
// cartera salían "nombres" como "Tienen en color negro?" porque la gente
// escribía su pregunta donde el chat pedía el nombre. Se quita el saludo
// ("hola, soy Carla" → "Carla") y se rechaza lo que parece pregunta o frase.
// Sin imports de servidor: lo usan el chat y /api/pvx/register.

const NOT_A_NAME_START =
  /^(como|cómo|que|qué|cual|cuál|cuanto|cuánto|cuanta|cuánta|donde|dónde|cuando|cuándo|por|para|tienen|tiene|tienes|hay|me|quiero|quisiera|necesito|busco|estoy|puedes|pueden|puede|precio|info|información|informacion|saber|el|la|los|las|un|una|si|no|ok|gracias|buenas|buenos)$/i;

export function cleanPersonName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const v = raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^(hola|holi|buenas(\s+(tardes|noches))?|buenos\s+d[ií]as|buen\s+d[ií]a)[\s,!.]*/i, "")
    .replace(/^(soy|me\s+llamo|mi\s+nombre\s+es)\s+/i, "")
    .replace(/[.,!]+$/, "")
    .trim();
  const words = v.split(" ").filter(Boolean);
  if (v.length < 2) return { ok: false, error: "Escribe tu nombre, porfa." };
  if (
    /[?¿@:/]|\d/.test(v) ||
    v.length > 50 ||
    words.length > 5 ||
    NOT_A_NAME_START.test(words[0] ?? "")
  )
    return { ok: false, error: "Primero dime solo tu nombre 😊 Tu pregunta te la respondo apenas terminemos." };
  return { ok: true, name: v };
}
