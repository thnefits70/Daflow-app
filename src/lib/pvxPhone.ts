// WhatsApp con prefijo de país obligatorio en el registro de provedix.com
// (idea de Daniel, pedida por el usuario 2026-10-13): la persona elige el país
// y escribe su celular; se revisa que tenga el largo y el inicio de un celular
// real de ese país. Sin imports de servidor: se usa en el navegador y en la API.

export type PhoneCountry = { iso: string; name: string; code: string; digits: number[]; starts: string[]; example: string };

// Solo celulares (WhatsApp). digits = largo del número sin el prefijo.
export const PHONE_COUNTRIES: PhoneCountry[] = [
  { iso: "EC", name: "Ecuador", code: "593", digits: [9], starts: ["9"], example: "99 123 4567" },
  { iso: "CO", name: "Colombia", code: "57", digits: [10], starts: ["3"], example: "300 123 4567" },
  { iso: "PE", name: "Perú", code: "51", digits: [9], starts: ["9"], example: "912 345 678" },
  { iso: "VE", name: "Venezuela", code: "58", digits: [10], starts: ["4"], example: "412 123 4567" },
  { iso: "CL", name: "Chile", code: "56", digits: [9], starts: ["9"], example: "9 1234 5678" },
  { iso: "MX", name: "México", code: "52", digits: [10], starts: [""], example: "55 1234 5678" },
  { iso: "AR", name: "Argentina", code: "54", digits: [10, 11], starts: ["9", "1", "2", "3"], example: "9 11 2345 6789" },
  { iso: "BO", name: "Bolivia", code: "591", digits: [8], starts: ["6", "7"], example: "7123 4567" },
  { iso: "PA", name: "Panamá", code: "507", digits: [8], starts: ["6"], example: "6123 4567" },
  { iso: "CR", name: "Costa Rica", code: "506", digits: [8], starts: ["5", "6", "7", "8"], example: "8312 3456" },
  { iso: "US", name: "Estados Unidos", code: "1", digits: [10], starts: [""], example: "305 123 4567" },
  { iso: "ES", name: "España", code: "34", digits: [9], starts: ["6", "7"], example: "612 345 678" },
];

export function phoneCountry(iso: string): PhoneCountry | undefined {
  return PHONE_COUNTRIES.find((c) => c.iso === iso);
}

// Devuelve el número completo "+<prefijo><número>" o el motivo por el que no vale.
export function checkWhatsapp(iso: string, local: string): { ok: true; full: string } | { ok: false; error: string } {
  const c = phoneCountry(iso);
  if (!c) return { ok: false, error: "Elige el país de tu WhatsApp." };
  let d = local.replace(/\D/g, "");
  // Si pegó el número con el prefijo, o con el 0 de adelante (099…), se quita.
  if (d.startsWith(c.code) && d.length - c.code.length >= Math.min(...c.digits)) d = d.slice(c.code.length);
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  if (!d) return { ok: false, error: "Escribe tu número de WhatsApp." };
  if (!c.digits.includes(d.length)) {
    return { ok: false, error: `Un celular de ${c.name} tiene ${c.digits.join(" u ")} dígitos después del +${c.code}. Ejemplo: ${c.example}.` };
  }
  if (!c.starts.some((s) => d.startsWith(s))) {
    return { ok: false, error: `Ese no parece un celular de ${c.name}. Ejemplo: +${c.code} ${c.example}.` };
  }
  return { ok: true, full: `+${c.code}${d}` };
}
