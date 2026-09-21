export function formatDateTime(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const date = d.toLocaleDateString("es-MX");
  const time = d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
}

// Para fechas puras (sin hora) como caducidad/elaboración: un <input type="date">
// manda "2026-01-01" y eso se guarda como medianoche UTC de ese día. Formatearlo
// en hora de Ecuador (UTC-5, o cualquier zona detrás de UTC) le resta un día —
// en 1 de enero, hasta le cambia el año. Formatear siempre en UTC hace que la
// fecha mostrada sea exactamente la que se escribió, sin importar la zona
// horaria del navegador o del servidor.
export function formatCalendarDate(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString("es-EC", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });
}
