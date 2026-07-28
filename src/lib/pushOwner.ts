// Mismo patrón sin FK que nancyOwnerId() — admin no es una fila real de
// User, así que sus suscripciones se guardan bajo el string sentinel "admin".
export function pushOwnerId(session: { user: { role: string; id: string } }): string {
  return session.user.role === "admin" ? "admin" : session.user.id;
}
