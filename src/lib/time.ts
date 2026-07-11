export function isFutureDate(iso: string | null | undefined): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() > Date.now();
}
