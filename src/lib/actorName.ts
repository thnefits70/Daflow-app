// El login de administrador es un solo perfil compartido sin un User real
// detrás (no tiene fila propia en la tabla User) — cuando el actor de una
// acción es null, siempre fue el administrador.
export function actorName(name: string | null | undefined): string {
  return name ?? "Andrés Damián";
}
