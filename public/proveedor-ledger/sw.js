// Service worker SOLO para los enlaces públicos del proveedor
// (dunxingchen.cc/proveedor-ledger/...) — confirmado 2026-09-23. Aparte del
// /sw.js de DAFLOW a propósito: ese dominio neutral no debe mostrar ningún
// nombre ni logo de la empresa, ni siquiera en el título por defecto de una
// notificación. Su alcance queda limitado a /proveedor-ledger/.
self.addEventListener("push", (event) => {
  let data = { title: "Pedidos por enviar", body: "Hay novedades en sus pedidos.", url: "/proveedor-ledger/" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // payload no era JSON válido — se usa el genérico de arriba
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      data: { url: data.url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/proveedor-ledger/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url) && "focus" in client) {
          client.navigate(url).catch(() => null);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
