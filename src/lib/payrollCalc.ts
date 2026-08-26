// Confirmado 2026-08-13: reglas de cálculo de la calculadora de Nómina,
// definidas junto al usuario tras varias rondas de diseño. Nunca se guardan
// resultados derivados sin recalcular — igual que financeKpisCalc.ts, todo
// se deriva siempre de los datos crudos.

// Confirmado 2026-08-17: pedido explícito del usuario, con su propio
// método de cálculo manual — el sueldo básico se divide entre 30 días y
// luego entre 9 horas trabajadas por día (no 8), así que el divisor total
// es 270. Antes era 240 (30 días × 8 horas).
export const OVERTIME_HOUR_DIVISOR = 270; // sueldo básico ÷ 270 = valor de 1 hora (30 días × 9h/día)
export const OVERTIME_WEEKDAY_MULTIPLIER = 1.5; // lunes a viernes (suplementaria)
export const OVERTIME_SATURDAY_MULTIPLIER = 2.0; // sábado (como feriado)
export const IESS_RATE = 0.0945;

// Confirmado 2026-08-26: label exacto de la línea automática de IESS (ver
// buildAutomaticLineItems en payroll.ts) — se usa como identificador para
// sumar el total de IESS de un período (ver iess-transfer), ya que
// PayrollLineItem no tiene una categoría propia más allá de INCOME/EXPENSE.
export const IESS_LINE_ITEM_LABEL = "Descuento IESS (9.45%)";

// Solo informativo para la pantalla del líder — el umbral de horario no se
// usa para calcular el monto (el líder ya reporta directamente los minutos
// extra), solo para que sepa desde cuándo cuenta.
export const OVERTIME_SCHEDULE_LABEL_DEFAULT =
  "Cuenta lo que pase después de las 6:30pm entre semana. El sábado 8:30am–1:30pm es turno normal, no cuenta como extra.";
export const OVERTIME_SCHEDULE_LABEL_FULL_LEGAL =
  "Cuenta lo que pase después de las 5:00pm entre semana. Todo el sábado 8:30am–12:30pm cuenta como extra.";

export function overtimeScheduleLabel(usesFullLegalOvertimeSchedule: boolean): string {
  return usesFullLegalOvertimeSchedule ? OVERTIME_SCHEDULE_LABEL_FULL_LEGAL : OVERTIME_SCHEDULE_LABEL_DEFAULT;
}

// Domingo nunca es un día válido — no se trabaja.
export function isValidOvertimeDate(date: Date): boolean {
  return date.getUTCDay() !== 0;
}

// Ecuador es UTC-5, sin horario de verano. Vercel corre en UTC, así que
// "ahora" siempre se pre-ajusta antes de comparar contra un día calendario
// — mismo patrón ya usado en pendingTasks.ts/birthdays.ts/periodicReminders.ts.
const ECUADOR_UTC_OFFSET_HOURS = 5;
export function nowInEcuador(): Date {
  return new Date(Date.now() - ECUADOR_UTC_OFFSET_HOURS * 3600 * 1000);
}

// Confirmado 2026-08-14: pedido explícito del usuario — antes daba hasta la
// medianoche del día SIGUIENTE (un colchón contra errores), pero eso hacía
// fácil que se les "quedara pendiente para el otro día" y se olvidaran.
// Ahora es estricto: solo se puede cargar o corregir el MISMO día
// trabajado, se cierra a la medianoche de ese mismo día (hora Ecuador).
export function isOvertimeEntryEditable(date: Date, now: Date = nowInEcuador()): boolean {
  const cutoff = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
  return now < cutoff;
}

// Confirmado 2026-08-17: pedido explícito del usuario — el cálculo de horas
// extra siempre usa este valor fijo, nunca el de PayrollSettings.nationalBaseSalary
// (ese campo queda sin uso para este cálculo por ahora). "No tomes ningún
// otro valor" — instrucción textual del usuario.
export const OVERTIME_NATIONAL_BASE_SALARY = 482;

// Confirmado 2026-08-13: el valor de la hora extra se calcula sobre el
// sueldo básico NACIONAL (compartido, igual para todos), nunca sobre el
// sueldo real de cada persona. Sábado paga distinto que entre semana, como
// un feriado.
export function computeOvertimeAmount(nationalBaseSalary: number, minutesExtra: number, date: Date): number {
  const hourValue = nationalBaseSalary / OVERTIME_HOUR_DIVISOR;
  const multiplier = date.getUTCDay() === 6 ? OVERTIME_SATURDAY_MULTIPLIER : OVERTIME_WEEKDAY_MULTIPLIER;
  return hourValue * multiplier * (minutesExtra / 60);
}

// Confirmado 2026-08-17: pedido explícito del usuario — cada vez que se
// genera el resultado, mostrar una breve descripción de cómo se calculó,
// para poder verificar que se hizo tal como se indicó. Resume el mes
// completo (todas las entradas aprobadas), no una entrada suelta.
export function describeOvertimeCalculation(entries: { minutesExtra: number; date: Date }[], nationalBaseSalary: number): string {
  const hourValue = nationalBaseSalary / OVERTIME_HOUR_DIVISOR;
  const weekdayMinutes = entries.filter((e) => e.date.getUTCDay() !== 6).reduce((s, e) => s + e.minutesExtra, 0);
  const saturdayMinutes = entries.filter((e) => e.date.getUTCDay() === 6).reduce((s, e) => s + e.minutesExtra, 0);
  const weekdayHours = weekdayMinutes / 60;
  const saturdayHours = saturdayMinutes / 60;

  const parts = [`Valor hora = $${nationalBaseSalary.toFixed(2)} ÷ ${OVERTIME_HOUR_DIVISOR} = $${hourValue.toFixed(2)}/h`];
  if (weekdayHours > 0) {
    const amt = hourValue * OVERTIME_WEEKDAY_MULTIPLIER * weekdayHours;
    parts.push(`L-V: ${weekdayHours.toFixed(2)}h × $${hourValue.toFixed(2)} × ${OVERTIME_WEEKDAY_MULTIPLIER} = $${amt.toFixed(2)}`);
  }
  if (saturdayHours > 0) {
    const amt = hourValue * OVERTIME_SATURDAY_MULTIPLIER * saturdayHours;
    parts.push(`Sáb: ${saturdayHours.toFixed(2)}h × $${hourValue.toFixed(2)} × ${OVERTIME_SATURDAY_MULTIPLIER} = $${amt.toFixed(2)}`);
  }
  return parts.join(" · ");
}

// Confirmado 2026-08-13: desfase de un mes — las horas extra de un mes
// completo (ej. julio) se pagan en la primera quincena del mes siguiente
// (ej. "2026-08-Q1"). Mismo desfase que usa el bono de Colaborador
// destacado (ver payoutMonthIsQ1AfterMonth más abajo).
export function overtimePayoutPeriod(workedMonth: string): string {
  const [y, m] = workedMonth.split("-").map(Number);
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-Q1`;
}

// Inverso de overtimePayoutPeriod — dado un período de pago ("YYYY-MM-Q1"
// o "YYYY-MM-Q2"), a qué mes trabajado corresponden las horas extra que se
// pagan ahí (null si ese período no paga horas extra — solo la Q1 paga).
export function overtimeSourceMonthForPeriod(period: string): string | null {
  const match = period.match(/^(\d{4})-(\d{2})-Q([12])$/);
  if (!match) return null;
  const [, yStr, mStr, q] = match;
  if (q !== "1") return null;
  const y = Number(yStr);
  const m = Number(mStr);
  const prevMonth = m === 1 ? 12 : m - 1;
  const prevYear = m === 1 ? y - 1 : y;
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
}

// Mismo desfase que las horas extra: el ganador de Colaborador destacado
// del mes M se paga en la primera quincena del mes M+1.
export function isFirstQuincenaOfMonth(period: string): boolean {
  return period.endsWith("-Q1");
}

export function isEndOfMonthQuincena(period: string): boolean {
  return period.endsWith("-Q2");
}

// "YYYY-MM-Qn" -> "YYYY-MM" (el mes calendario al que pertenece el período).
export function monthOfPeriod(period: string): string {
  return period.slice(0, 7);
}

export function quincenalSalaryPortion(realSalary: number): number {
  return realSalary / 2;
}

// Confirmado 2026-08-13: excepción para Andrés y Marcos — Provedix asume el
// 100% del IESS, así que a ellos no se les descuenta nada en su rol.
export function computeIessDeduction(iessDeclaredSalary: number, companyAbsorbsIess: boolean): number {
  if (companyAbsorbsIess) return 0;
  return iessDeclaredSalary * IESS_RATE;
}

// "Rol del mes" — lo único que ve cada colaborador. Se calcula sobre el
// sueldo DECLARADO (la mitad del básico para casi todos), nunca el real.
export function computeMonthlyLegalRole(iessDeclaredSalary: number, companyAbsorbsIess: boolean) {
  const iessDeduction = computeIessDeduction(iessDeclaredSalary, companyAbsorbsIess);
  return { declaredSalary: iessDeclaredSalary, iessDeduction, netTotal: iessDeclaredSalary - iessDeduction };
}

// Confirmado 2026-08-18: mecanismo compartido por los 3 egresos automáticos
// (compras personales, anticipos, descuentos por mala gestión) — todos
// reparten un monto total en N cuotas mensuales iguales, empezando en un
// mes de arranque.
export function addMonthsToMonthStr(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Cantidad de meses calendario entre `from` y `to` (puede ser negativo).
export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

// Reparte totalAmount en `installments` cuotas iguales (redondeadas a 2
// decimales) — el resto de redondeo lo absorbe la ÚLTIMA cuota, para que la
// suma de todas las cuotas sea exactamente igual a totalAmount.
export function installmentAmount(totalAmount: number, installments: number, installmentIndex: number): number {
  const base = Math.round((totalAmount / installments) * 100) / 100;
  if (installmentIndex < installments - 1) return base;
  return Math.round((totalAmount - base * (installments - 1)) * 100) / 100;
}

// Dado un mes de arranque y cuántas cuotas tiene el egreso, ¿corresponde
// cobrar algo en `targetMonth`? Devuelve el índice de cuota (0-based) o
// null si `targetMonth` cae antes del arranque o después de la última cuota.
export function installmentIndexForMonth(firstMonth: string, installments: number, targetMonth: string): number | null {
  const idx = monthsBetween(firstMonth, targetMonth);
  if (idx < 0 || idx >= installments) return null;
  return idx;
}
