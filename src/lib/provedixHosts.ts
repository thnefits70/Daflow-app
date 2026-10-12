// Dominio público de Provedix (pedido del usuario 2026-10-12, etapa 3): apunta
// al MISMO deployment de Vercel que DAFLOW. En ese dominio solo se sirve la
// página pública (/pvx) y sus rutas de apoyo — nunca nada de DAFLOW (mismo
// criterio que el dominio de CHEN en proxy.ts). Sin dependencias de servidor.
export const PROVEDIX_HOSTS = ["provedix.com", "www.provedix.com"];

export const PROVEDIX_PUBLIC_PREFIXES = ["/pvx", "/api/pvx"];

export function isProvedixHost(hostname: string | null | undefined): boolean {
  return !!hostname && PROVEDIX_HOSTS.includes(hostname.toLowerCase());
}
