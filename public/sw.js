// Service worker de notificaciones push — confirmado 2026-07-28: solo abre
// la pantalla correcta al tocar la notificación (o la enfoca si ya está
// abierta). No hay botón de "marcar hecho" dentro de la notificación misma:
// la mayoría de los "Pendientes" (Roles de pago, KPIs, Feedback) requieren
// entrar y cargar datos reales, no un simple check — así que "resolverlo" de
// verdad solo pasa adentro de DAFLOW. Descartar la notificación (swipe/X) ya
// lo hace el propio sistema operativo, sin necesitar código aquí.
// Una versión nueva de este archivo entra en uso enseguida, sin esperar a que
// se cierren todas las pestañas de DAFLOW.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = { title: "DAFLOW", body: "Tienes un pendiente.", url: "/" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // payload no era JSON válido — se usa el genérico de arriba
  }

  // 2026-09-30 (versión 2): después de mostrar el aviso, el celular le dice
  // a DAFLOW "lo recibí" (/api/push/ack). Así DAFLOW detecta solo un celular
  // que no muestra los avisos (p.ej. Chrome cerrado por ahorro de batería).
  event.waitUntil(
    self.registration
      .showNotification(data.title, {
        body: data.body,
        icon: data.icon || "/icon.svg",
        badge: data.icon || "/icon.svg",
        data: { url: data.url },
      })
      .then(() => {
        if (!data.sid) return;
        if (typeof Notification !== "undefined" && Notification.permission !== "granted") return;
        return fetch("/api/push/ack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sid: data.sid, st: data.st }),
        }).catch(() => null);
      })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
