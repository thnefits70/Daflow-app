/* eslint-disable @next/next/no-html-link-for-pages -- en provedix.com "/" la arma el proxy (reescritura a /pvx): se navega con recarga completa a propósito. */
import type { Metadata } from "next";
import { PvxPlainPage } from "@/components/pvx/PvxPlainPage";
import { WORK_HOURS_TEXT } from "@/lib/pvxFaq";

// provedix.com/privacidad (pedido del usuario 2026-10-16): qué datos guarda la
// página y para qué, según la Ley Orgánica de Protección de Datos Personales
// de Ecuador. Solo "Guayaquil, Ecuador", sin dirección exacta. Si cambia lo
// que se guarda (registro, chat, calificaciones), actualizar este texto y la fecha.
export const metadata: Metadata = {
  title: "Política de privacidad | Provedix",
  description: "Qué datos guarda Provedix cuando usas provedix.com, para qué los usamos y cómo pedir que los borremos.",
  alternates: { canonical: "/privacidad" },
  robots: { index: true, follow: true },
};

const UPDATED = "17 de octubre de 2026";

const SECTIONS: { title: string; body: React.ReactNode }[] = [
  {
    title: "Quiénes somos",
    body: (
      <p>
        Provedix (Importadora Damián) es proveedor de productos para dropshippers que venden por Dropi y Rocket, con bodega en Guayaquil, Ecuador. Somos los
        responsables de los datos que nos das en provedix.com.
      </p>
    ),
  },
  {
    title: "Qué datos guardamos",
    body: (
      <ul>
        <li>
          <b>Si te registras:</b> tu nombre, tu WhatsApp (con su país), el nombre de tu tienda, la plataforma donde vendes y tu correo si decides darlo.
        </li>
        <li>
          <b>Cómo usas la página:</b> qué productos abres, qué buscas y qué herramientas usas (por ejemplo, la calculadora). Lo usamos para saber qué productos
          interesan más.
        </li>
        <li>
          <b>Tus conversaciones con Michelle IA:</b> los mensajes que le escribes, las fotos o videos que adjuntes (por ejemplo, la evidencia de una garantía) y,
          si pides revisar un pedido, los datos que des para encontrarlo (número de guía, tu tienda o el nombre de tu cliente). Los archivos se guardan en un
          espacio privado: solo los ves tú y el equipo que atiende tu caso.
        </li>
        <li>
          <b>Tus calificaciones:</b> las estrellas y el comentario que dejes sobre la página.
        </li>
      </ul>
    ),
  },
  {
    title: "Para qué los usamos",
    body: (
      <ul>
        <li>Mostrarte la ficha completa de los productos y recordar que ya te registraste.</li>
        <li>Enviarte por WhatsApp productos ganadores nuevos, solo si marcaste la casilla al registrarte.</li>
        <li>Atenderte: responder tus dudas, revisar tus pedidos y gestionar garantías.</li>
        <li>Mejorar la página y los productos que ofrecemos.</li>
        <li>Proteger la página: detectar y bloquear usos indebidos o automáticos.</li>
      </ul>
    ),
  },
  {
    title: "Michelle IA",
    body: (
      <p>
        Michelle IA es una asistente virtual con inteligencia artificial. Para responderte, tus mensajes y las fotos que adjuntas se procesan con un servicio de inteligencia artificial. Si
        tu caso necesita a una persona, el equipo la lee y te responde en el mismo chat. No escribas en el chat contraseñas ni datos de tarjetas: nunca te los
        vamos a pedir.
      </p>
    ),
  },
  {
    title: "Con quién los compartimos",
    body: (
      <p>
        No vendemos ni alquilamos tus datos. Solo los ve nuestro equipo y los servicios que necesitamos para que la página funcione (alojamiento en la nube e
        inteligencia artificial), que pueden estar fuera de Ecuador y los usan solo para prestarnos ese servicio. Nunca mostramos en la página datos de tus clientes
        ni de tu tienda; las cifras de ventas se muestran en rangos y sin datos personales.
      </p>
    ),
  },
  {
    title: "Cookies",
    body: (
      <p>
        Usamos solo cookies propias para recordar tu visita y tu registro. No usamos cookies de publicidad ni herramientas de seguimiento de otras empresas.
      </p>
    ),
  },
  {
    title: "Cuánto tiempo los guardamos",
    body: <p>Mientras sigas registrado o hasta que nos pidas borrarlos. Algunos datos de pedidos y garantías se guardan el tiempo que exige la ley.</p>,
  },
  {
    title: "Tus derechos",
    body: (
      <>
        <p>
          Puedes pedir en cualquier momento ver tus datos, corregirlos, borrarlos, llevártelos o que dejemos de usarlos, y darte de baja de los mensajes de
          WhatsApp. Pídelo en el chat de Michelle IA en <a href="/#michelle">provedix.com</a> (botón abajo a la derecha); el equipo lo atiende en horario de
          trabajo ({WORK_HOURS_TEXT}). Te respondemos en un máximo de 15 días.
        </p>
      </>
    ),
  },
  {
    title: "Menores de edad",
    body: <p>provedix.com es para personas mayores de 18 años que venden por internet.</p>,
  },
  {
    title: "Cambios a esta política",
    body: <p>Si cambiamos algo importante, lo publicaremos en esta página con la fecha nueva.</p>,
  },
];

export default function PrivacyPage() {
  return (
    <PvxPlainPage>
      <h1 className="pvx-display text-[38px] sm:text-[56px]">
        Política de <span className="text-[var(--pvx-orange)]">privacidad</span>
      </h1>
      <p className="mt-4 text-[15px] text-[var(--pvx-ink-2)]">Última actualización: {UPDATED}</p>
      <div className="pvx-legal mt-10 flex flex-col gap-10">
        {SECTIONS.map((s) => (
          <section key={s.title}>
            <h2 className="pvx-heading text-[22px] sm:text-[26px]">{s.title}</h2>
            <div className="mt-3 text-[16px] leading-relaxed text-[var(--pvx-ink-2)]">{s.body}</div>
          </section>
        ))}
      </div>
    </PvxPlainPage>
  );
}
