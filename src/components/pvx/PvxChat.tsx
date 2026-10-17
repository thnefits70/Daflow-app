"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  PVX_CALC_EVENT,
  PVX_PRODUCT_EVENT,
} from "@/components/pvx/PvxCalculator";
import { markPvxUse } from "@/components/pvx/PvxRating";
import {
  IconArrow,
  IconCalc,
  IconClose,
  IconExternal,
  IconLock,
} from "@/components/pvx/PvxIcons";
import { ADVISOR_RESPONSE_PROMISE, WORK_HOURS_TEXT } from "@/lib/pvxFaq";
import { linksOf, PVX_LINKS } from "@/lib/pvxLinks";
import { PvxChatRegister } from "@/components/pvx/PvxChatRegister";

// Chat con Michelle, la asistente virtual de provedix.com (2026-10-15).
// Se presenta siempre como asistente virtual con IA. Desde 2026-10-16 todo se
// atiende aquí, nada por WhatsApp: lo que la IA no resuelve lo responde el
// equipo en este mismo chat (sale firmado), y el dropshipper adjunta fotos o
// videos con el botón 📎.

// Otras partes de la página abren el chat con una pregunta lista para enviar
// (p. ej. "Preguntar a Michelle IA" en un producto).
export const PVX_ASK_EVENT = "pvx-ask";
const SEEN_KEY = "pvx-chat-seen";

// Embudo de Michelle IA (2026-10-17): por dónde se abrió el chat y si alguien
// se registró desde el chat. Ver src/lib/provedixMichelleFunnel.ts.
type OpenSource = "enlace" | "boton" | "producto" | "pagina";
function trackChat(type: "chat_open" | "chat_register", source?: OpenSource) {
  fetch("/api/pvx/chat/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, source }),
    keepalive: true,
  }).catch(() => null);
}

type Msg = { role: "user" | "assistant"; content: string };
const CHAT_KEY = "pvx-chat-id";
// Marca que pone la IA al final cuando ya no puede resolver el caso (ver provedixMichelle.ts).
export const HANDOFF_MARK = "[[ASESORA";
// [[ASESORA:MC-0007]] → caso con resumen para la asesora (2026-10-15).
export const caseCodeOf = (t: string) =>
  t.match(/\[\[ASESORA:(MC-\d{4,})\]\]/)?.[1] ?? null;
// Quita la marca (también a medio llegar mientras se escribe la respuesta).
// [[BLOQUEAR]]: la IA cerró el chat por un intento de sacar información confidencial.
const BLOCK_MARK = "[[BLOQUEAR]]";
// Botones de producto (2026-10-14): [[DROPI:ID]] precio en Dropi, [[CREATIVOS:ID]], [[LANDING:ID]].
const ACTION_RE = /\[\[(DROPI|CREATIVOS|LANDING|CALC|FICHA):(\d{3,8})\]\]/g;
// [[IR:cortes]] → botón que cierra el chat y lleva a esa parte de la página (2026-10-15).
const SECTION_RE =
  /\[\[IR:(cortes|recursos|calculadora|productos|como-funciona|preguntas|transportadoras)\]\]/g;
export const SECTION_LABEL: Record<string, string> = {
  cortes: "Ver los cortes de hoy",
  recursos: "Rastreo, creativos y garantías",
  calculadora: "Abrir la calculadora",
  productos: "Ver los productos",
  "como-funciona": "Cómo funciona Provedix",
  transportadoras: "Ver qué transportadora entrega mejor",
  preguntas: "Ver preguntas frecuentes",
};
export const sectionsOf = (t: string) =>
  [...new Set([...t.matchAll(SECTION_RE)].map((m) => m[1]))].slice(0, 3);
export const ACTION_LABEL: Record<string, string> = {
  DROPI: "Ver precio en Dropi",
  CREATIVOS: "Ver creativos",
  LANDING: "Ver landing",
};
export function actionsOf(t: string): { kind: string; code: string }[] {
  const seen = new Set<string>();
  const out: { kind: string; code: string }[] = [];
  for (const m of t.matchAll(ACTION_RE)) {
    if (seen.has(m[1] + m[2])) continue;
    seen.add(m[1] + m[2]);
    out.push({ kind: m[1], code: m[2] });
  }
  return out.slice(0, 6);
}
// Foto de evidencia de una guía retenida (la escribe el equipo, 2026-10-15).
const PHOTO_RE = /\[\[FOTO:([a-z0-9]{10,40})\]\]/gi;
export const photoIdsOf = (t: string) =>
  [...t.matchAll(PHOTO_RE)].map((m) => m[1]).slice(0, 2);
// Respuesta escrita por la persona del equipo desde DAFLOW: [[EQUIPO:Michelle]] texto.
const TEAM_RE = /^\[\[EQUIPO:([^\]]{1,40})\]\]\s*/;
export const teamOf = (t: string) => t.match(TEAM_RE)?.[1] ?? null;
// Foto o video que adjuntó el dropshipper: [[ADJUNTO:id:image]].
const ATTACH_RE = /\[\[ADJUNTO:([a-z0-9]{10,40}):(image|video)\]\]/gi;
export const attachmentsOf = (t: string) =>
  [...t.matchAll(ATTACH_RE)].map((m) => ({ id: m[1], kind: m[2] }));
function readSeen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}
function saveSeen(n: number) {
  try {
    localStorage.setItem(SEEN_KEY, String(n));
  } catch {
    // sin almacenamiento: no se marca "respuesta nueva"
  }
}
// Varios mensajes cortos, como en WhatsApp (2026-10-17): la IA separa las
// partes con [[SEP]] y aquí cada una sale en su propia burbuja.
const SEP_RE = /\s*\[\[SEP\]\]\s*/;
export const partsOf = (t: string): string[] => {
  const p = t.split(SEP_RE).filter((x, i, a) => x.trim() || i === a.length - 1);
  return p.length ? p : [""];
};
export const cleanReply = (t: string) =>
  t
    .replace(/\[\[SEP\]\]/g, "")
    .replace(TEAM_RE, "")
    .replace(ATTACH_RE, "")
    .replace(/\[\[(ASESORA(:[A-Z0-9-]*)?|BLOQUEAR|SOSPECHA)\]\]/g, "")
    .replace(ACTION_RE, "")
    .replace(SECTION_RE, "")
    .replace(/\[\[ENLACE:[a-z-]+\]\]/g, "")
    .replace(PHOTO_RE, "")
    // marca a medio llegar mientras se escribe la respuesta
    .replace(/\[(\[[A-Z]*(:[a-z0-9-]*)?\]?)?$/, "")
    .trim();
// Pocas y cortas (pedido del usuario 2026-10-17: el chat se veía sobrecargado).
const SUGGESTIONS = [
  "¿Qué productos van en subida?",
  "¿Cómo empiezo a vender?",
  "¿A cuánto vendo para ganar?",
];

function readChatId(): string | null {
  try {
    return localStorage.getItem(CHAT_KEY);
  } catch {
    return null;
  }
}
function saveChatId(id: string) {
  try {
    localStorage.setItem(CHAT_KEY, id);
  } catch {
    // sin almacenamiento: la conversación igual sigue mientras la página esté abierta
  }
}

// Negritas (**texto**) y saltos de línea; nada de HTML.
export function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {line
            .split(/(\*\*[^*]+\*\*)/g)
            .map((part, k) =>
              part.startsWith("**") && part.endsWith("**") ? (
                <b key={k}>{part.slice(2, -2)}</b>
              ) : (
                <Fragment key={k}>{part}</Fragment>
              ),
            )}
        </Fragment>
      ))}
    </>
  );
}

export function Avatar({ size = 36 }: { size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-[var(--pvx-orange)] font-black italic text-white"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
      aria-hidden
    >
      M
    </span>
  );
}

// Límites de adjuntos (iguales a src/lib/provedixAttachments.ts). Se avisan
// antes de adjuntar y se revisan al instante, sin esperar la subida (2026-10-16).
const MAX_VIDEO_MB = 50;
const MAX_IMAGE_MB = 15;

// Fotos grandes se achican en el teléfono antes de enviarse (lado mayor 2000 px,
// JPEG): así nunca pasan el límite y suben rápido. Si el navegador no puede
// leerla (p. ej. HEIC en algunos), se envía tal cual.
async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size < 1.5 * 1024 * 1024)
    return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) =>
      canvas.toBlob(r, "image/jpeg", 0.85),
    );
    return blob && blob.size < file.size
      ? new File([blob], "foto.jpg", { type: "image/jpeg" })
      : file;
  } catch {
    return file;
  }
}

function IconClip({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

// Foto o video adjunto (solo lo ve el dueño del chat).
function Attachment({ id, kind }: { id: string; kind: string }) {
  const src = `/api/pvx/chat/file/${id}`;
  return kind === "video" ? (
    <video
      src={src}
      controls
      preload="metadata"
      className="mt-1 max-h-72 w-full rounded-xl bg-black"
    />
  ) : (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 block overflow-hidden rounded-xl"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Foto que adjuntaste"
        className="max-h-72 w-full object-cover"
        loading="lazy"
      />
    </a>
  );
}

export function PvxChat({
  registered,
  name = null,
  onRegistered,
}: {
  registered: boolean;
  // Nombre del registrado (2026-10-17): el saludo lo usa.
  name?: string | null;
  // Ya no se usa desde el chat (el registro es dentro del chat, 2026-10-17).
  onRegister?: () => void;
  // Se registró desde el chat: la página lo marca como registrado.
  onRegistered?: (name: string) => void;
}) {
  // Entró por el enlace provedix.com/michelle: el chat viene ABIERTO desde el
  // servidor (2026-10-17), se ve apenas llega la página, sin esperar al
  // JavaScript ni a un retraso.
  const viaLink = usePathname().endsWith("/michelle");
  const [open, setOpen] = useState(viaLink);
  useEffect(() => {
    if (viaLink) {
      trackChat("chat_open", "enlace");
      return;
    }
    // Enlace con #michelle desde otra página: se abre al cargar.
    if (window.location.hash !== "#michelle") return;
    const t = setTimeout(() => {
      setOpen(true);
      trackChat("chat_open", "pagina");
    }, 0);
    return () => clearTimeout(t);
  }, [viaLink]);
  // Enlaces "#michelle" dentro de la página (p. ej. "Pedir garantía a Michelle IA") abren el chat.
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash !== "#michelle") return;
      setOpen(true);
      trackChat("chat_open", "pagina");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [blocked, setBlocked] = useState(false);
  // Texto del bloqueo: permanente o de 24 h por datos de guía (lo manda el servidor).
  const [blockedMsg, setBlockedMsg] = useState(
    "Por seguridad, esta conversación quedó cerrada 🔒",
  );
  const listRef = useRef<HTMLDivElement>(null);
  // Última vez que se trajo la conversación: al volver a abrir el chat se
  // actualiza (así ve la respuesta del equipo sobre su guía, 2026-10-15).
  const lastLoadRef = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Subiendo un adjunto: porcentaje (null = nada subiendo).
  const [uploading, setUploading] = useState<number | null>(null);
  // Respuesta nueva del equipo mientras el chat estaba cerrado (2026-10-16).
  const [unread, setUnread] = useState(false);
  // Respuesta en vivo: sus partes salen una por una con "escribiendo…" entre ellas.
  const [live, setLive] = useState<{ idx: number; shown: number } | null>(null);
  const msgCountRef = useRef(0);
  useEffect(() => {
    msgCountRef.current = messages.length;
  }, [messages.length]);
  useEffect(() => {
    if (!live) return;
    const m = messages[live.idx];
    if (!m) return;
    const parts = partsOf(m.content);
    // La siguiente burbuja aparece cuando ya llegó (hay una después) o terminó de escribir.
    if (live.shown >= parts.length || (live.shown === parts.length - 1 && busy))
      return;
    const prev = parts[live.shown - 1] ?? "";
    const t = setTimeout(
      () => setLive((l) => (l ? { ...l, shown: l.shown + 1 } : l)),
      Math.min(1800, 600 + prev.length * 12),
    );
    return () => clearTimeout(t);
  }, [live, messages, busy]);
  // Sin registro (2026-10-17): 2 preguntas gratis y luego el registro aquí mismo.
  const [trialLeft, setTrialLeft] = useState<number | null>(null);
  const [regFlow, setRegFlow] = useState(false);
  const showRegister = !registered && (regFlow || trialLeft === 0);

  // Sin abrir el chat: ¿el equipo respondió algo nuevo? (una sola consulta al cargar la página)
  useEffect(() => {
    const id = readChatId();
    if (!id || !registered) return;
    fetch(`/api/pvx/chat?chatId=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list: Msg[] = Array.isArray(d?.messages) ? d.messages : [];
        const last = list[list.length - 1];
        if (
          list.length > readSeen() &&
          last?.role === "assistant" &&
          teamOf(last.content)
        )
          setUnread(true);
      })
      .catch(() => null);
  }, [registered]);
  // Al ver la conversación, lo que hay queda como leído.
  useEffect(() => {
    if (open && loaded) saveSeen(messages.length);
  }, [open, loaded, messages.length]);
  // "Preguntar a Michelle IA" desde otra parte de la página: abre el chat con la pregunta lista.
  useEffect(() => {
    const onAsk = (e: Event) => {
      const d = (
        e as CustomEvent<string | { text: string; source: OpenSource }>
      ).detail;
      const text = typeof d === "string" ? d : d?.text;
      setOpen(true);
      trackChat(
        "chat_open",
        typeof d === "object" && d?.source ? d.source : "pagina",
      );
      setUnread(false);
      if (text) setInput(text);
      setTimeout(() => inputRef.current?.focus(), 300);
    };
    window.addEventListener(PVX_ASK_EVENT, onAsk);
    return () => window.removeEventListener(PVX_ASK_EVENT, onAsk);
  }, []);

  // Al abrir: retoma la conversación guardada (y la actualiza si pasó más de 1 minuto).
  useEffect(() => {
    if (!open || busy || (loaded && Date.now() - lastLoadRef.current < 60_000))
      return;
    lastLoadRef.current = Date.now();
    const id = readChatId();
    fetch(`/api/pvx/chat${id ? `?chatId=${encodeURIComponent(id)}` : ""}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.chatId) setChatId(d.chatId);
        if (Array.isArray(d?.messages)) setMessages(d.messages);
        if (d?.blocked) {
          setBlocked(true);
          if (d.blockedText) setBlockedMsg(d.blockedText);
        }
        if (typeof d?.remaining === "number") setRemaining(d.remaining);
        if (typeof d?.trialLeft === "number") setTrialLeft(d.trialLeft);
      })
      .catch(() => null)
      .finally(() => setLoaded(true));
  }, [open, loaded, busy]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy]);

  // Con el chat abierto no se pide calificar (PvxRating lo mira).
  useEffect(() => {
    document.body.dataset.pvxChat = open ? "1" : "";
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;
      setError("");
      setInput("");
      setBusy(true);
      setLive({ idx: msgCountRef.current + 1, shown: 1 });
      setMessages((m) => [
        ...m,
        { role: "user", content: text },
        { role: "assistant", content: "" },
      ]);
      try {
        const res = await fetch("/api/pvx/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, chatId: chatId ?? undefined }),
        });
        if (!res.ok || !res.body) {
          const d = await res.json().catch(() => null);
          setMessages((m) => m.slice(0, -2));
          // Se acabaron las preguntas gratis: pasa al registro dentro del chat.
          if (d?.needsRegister) {
            setTrialLeft(0);
            setRegFlow(true);
            setInput(text);
            return;
          }
          setError(
            d?.error ??
              "No pude responder ahora. Intenta de nuevo en un momento.",
          );
          if (typeof d?.remaining === "number") setRemaining(d.remaining);
          if (d?.blocked) {
            setBlocked(true);
            if (d.blockedText) setBlockedMsg(d.blockedText);
          }
          setInput(text);
          return;
        }
        const id = res.headers.get("X-Chat-Id");
        if (id) {
          setChatId(id);
          saveChatId(id);
        }
        const rem = res.headers.get("X-Remaining");
        if (rem != null) setRemaining(Number(rem));
        const tl = res.headers.get("X-Trial-Left");
        if (tl != null) setTrialLeft(Number(tl));
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setMessages((m) => [
            ...m.slice(0, -1),
            { role: "assistant", content: acc },
          ]);
          if (acc.includes(BLOCK_MARK)) {
            setBlocked(true);
            if (/24 horas/.test(acc))
              setBlockedMsg(
                "Por seguridad, este chat quedó bloqueado durante 24 horas 🔒",
              );
          }
        }
        if (acc.trim()) markPvxUse("michelle");
      } catch {
        setError("Se perdió la conexión. Intenta de nuevo.");
      } finally {
        // Lo recién conversado ya está en pantalla: no volver a traerlo enseguida.
        lastLoadRef.current = Date.now();
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [busy, chatId],
  );

  // Adjuntar foto o video (2026-10-16): pide un enlace firmado y sube directo.
  const attach = useCallback(
    async (picked: File) => {
      if (uploading != null) return;
      setError("");
      const isVideo = picked.type.startsWith("video/");
      // Video muy pesado: se avisa al instante con qué hacer, sin intentar subirlo.
      if (isVideo && picked.size > MAX_VIDEO_MB * 1024 * 1024) {
        setError(
          `Ese video pesa ${Math.round(picked.size / 1024 / 1024)} MB y el máximo es ${MAX_VIDEO_MB} MB 🙏 Grábalo más corto (unos 30 segundos alcanzan) o envíalo en partes, un video por vez.`,
        );
        if (fileRef.current) fileRef.current.value = "";
        return;
      }
      setUploading(0);
      const file = isVideo ? picked : await shrinkImage(picked);
      if (!isVideo && file.size > MAX_IMAGE_MB * 1024 * 1024) {
        setError(
          `Esa foto pesa más de ${MAX_IMAGE_MB} MB. Prueba con una captura de pantalla de la foto.`,
        );
        setUploading(null);
        if (fileRef.current) fileRef.current.value = "";
        return;
      }
      try {
        const res = await fetch("/api/pvx/chat/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatId: chatId ?? undefined,
            type: file.type || "application/octet-stream",
            size: file.size,
          }),
        });
        const d = await res.json().catch(() => null);
        if (!res.ok || !d?.uploadUrl) {
          setError(d?.error ?? "No se pudo enviar el archivo.");
          return;
        }
        if (d.chatId) {
          setChatId(d.chatId);
          saveChatId(d.chatId);
        }
        const ok = await new Promise<boolean>((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", d.uploadUrl);
          xhr.setRequestHeader("Content-Type", file.type);
          xhr.setRequestHeader("x-upsert", "false");
          xhr.upload.onprogress = (ev) =>
            ev.lengthComputable &&
            setUploading(Math.round((ev.loaded / ev.total) * 100));
          xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
          xhr.onerror = () => resolve(false);
          xhr.send(file);
        });
        if (!ok) {
          setError(
            "Se cortó la subida. Revisa tu internet e intenta de nuevo.",
          );
          return;
        }
        const done = await fetch(`/api/pvx/chat/upload/${d.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId: d.chatId }),
        });
        const dd = await done.json().catch(() => null);
        if (!done.ok || !dd?.content) {
          setError(dd?.error ?? "No se pudo enviar el archivo.");
          return;
        }
        setMessages((m) => [...m, { role: "user", content: dd.content }]);
        lastLoadRef.current = Date.now();
      } catch {
        setError("Se perdió la conexión. Intenta de nuevo.");
      } finally {
        setUploading(null);
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    [chatId, uploading],
  );

  const outOfMessages = remaining === 0;

  return (
    <>
      <button
        type="button"
        data-tour="chat"
        onClick={() => {
          if (!open) trackChat("chat_open", "boton");
          setOpen(!open);
          setUnread(false);
        }}
        aria-expanded={open}
        aria-label={
          open
            ? "Cerrar el chat con Michelle"
            : "Abrir el chat con Michelle, asistente virtual"
        }
        className="pvx-press fixed bottom-4 right-4 z-[46] inline-flex items-center gap-2.5 rounded-full bg-[var(--pvx-ink)] py-2 pl-2 pr-4 text-left text-white shadow-[0_14px_34px_-12px_rgb(0_0_0/0.65)] ring-1 ring-white/15 hover:bg-[#25282f] cursor-pointer sm:bottom-6 sm:right-6"
      >
        <span className="relative">
          <Avatar size={34} />
          {unread && !open && (
            <span
              className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-[#3ddc84] ring-2 ring-[var(--pvx-ink)]"
              aria-hidden
            />
          )}
        </span>
        <span className="leading-tight">
          <span className="block text-[14px] font-bold">
            {open
              ? "Cerrar chat"
              : unread
                ? "Tienes una respuesta"
                : "Pregúntale a Michelle"}
          </span>
          <span className="block text-[12px] font-semibold text-white/60">
            {unread && !open
              ? "Del equipo de Provedix"
              : "Asistente virtual · IA"}
          </span>
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Chat con Michelle, asistente virtual de Provedix"
          className="pvx-sheet fixed inset-x-0 bottom-0 z-[47] flex h-[min(88dvh,640px)] flex-col overflow-hidden rounded-t-[26px] bg-white text-[var(--pvx-ink)] shadow-[0_30px_80px_-20px_rgb(0_0_0/0.55)] sm:inset-x-auto sm:bottom-24 sm:right-6 sm:w-[390px] sm:rounded-[26px]"
        >
          <div className="flex items-center gap-3 bg-[var(--pvx-night)] px-4 py-3 text-white">
            <Avatar />
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-bold">Michelle</div>
              <div className="text-[12px] text-white/65">
                Asistente virtual de Provedix · responde con IA
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar chat"
              className="pvx-press grid h-9 w-9 place-items-center rounded-full bg-white/10 hover:bg-white/20 cursor-pointer"
            >
              <IconClose className="w-5 h-5" />
            </button>
          </div>

          <div
            ref={listRef}
            className="flex-1 overflow-y-auto overscroll-contain bg-[var(--pvx-paper-2)] px-3 py-4"
            aria-live="polite"
          >
            <div className="flex gap-2">
              <Avatar size={28} />
              <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-white px-3.5 py-2.5 text-[14.5px] leading-relaxed">
                {registered ? (
                  <>
                    ¡Hola{name ? `, ${name.trim().split(/\s+/)[0]}` : ""}! 👋 Soy{" "}
                    <b>Michelle</b>, de Provedix 😊 ¿En qué te ayudo hoy?
                  </>
                ) : (
                  // Sin registro (2026-10-17): sin hablar de límites ni de registro;
                  // si hace falta, el chat lo pide solo conversando.
                  <>
                    ¡Hola! 👋 Soy <b>Michelle</b>, de Provedix 😊 ¿En qué te
                    ayudo hoy?
                  </>
                )}
              </div>
            </div>

            {!blocked && !showRegister && messages.length === 0 && loaded && (
              <div className="mt-3 flex flex-wrap gap-1.5 pl-9">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="pvx-press rounded-full border border-[var(--pvx-paper-3)] bg-white px-3 py-1.5 text-[13px] font-semibold hover:border-[var(--pvx-orange)] cursor-pointer"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="mt-3 flex justify-end">
                  {attachmentsOf(m.content).length > 0 ? (
                    <div className="w-[70%] max-w-[260px]">
                      {attachmentsOf(m.content).map((a) => (
                        <Attachment key={a.id} id={a.id} kind={a.kind} />
                      ))}
                    </div>
                  ) : (
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-md bg-[var(--pvx-ink)] px-3.5 py-2.5 text-[14.5px] leading-relaxed text-white">
                      {m.content}
                    </div>
                  )}
                </div>
              ) : (
                (() => {
                  const parts = partsOf(m.content);
                  const visible =
                    live && live.idx === i
                      ? Math.min(live.shown, parts.length)
                      : parts.length;
                  const done = visible >= parts.length;
                  const head = done
                    ? parts.slice(0, -1)
                    : parts.slice(0, visible);
                  const tail = parts[parts.length - 1] ?? "";
                  return (
                    <Fragment key={i}>
                      {head.map((p, k) => (
                        <div
                          key={k}
                          className={`${k === 0 ? "mt-3" : "mt-1.5"} flex gap-2`}
                        >
                          {k === 0 ? (
                            teamOf(m.content) ? (
                              <span
                                className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--pvx-ink)] text-[12px] font-black text-white"
                                aria-hidden
                              >
                                {teamOf(m.content)!.slice(0, 1)}
                              </span>
                            ) : (
                              <Avatar size={28} />
                            )
                          ) : (
                            <span className="w-7 shrink-0" aria-hidden />
                          )}
                          <div
                            className={`max-w-[85%] rounded-2xl ${k === 0 ? "rounded-tl-md" : ""} px-3.5 py-2.5 text-[14.5px] leading-relaxed ${teamOf(m.content) ? "bg-[#fff1e8] ring-1 ring-[var(--pvx-orange)]/30" : "bg-white"}`}
                          >
                            {k === 0 && teamOf(m.content) && (
                              <span className="mb-0.5 block text-[12px] font-bold text-[var(--pvx-orange-text)]">
                                {teamOf(m.content)} · equipo de Provedix
                              </span>
                            )}
                            <Rich text={cleanReply(p)} />
                          </div>
                        </div>
                      ))}
                      {!done ? (
                        <div className="mt-1.5 flex gap-2">
                          <span className="w-7 shrink-0" aria-hidden />
                          <div className="rounded-2xl bg-white px-3.5 py-2.5">
                            <span
                              className="inline-flex gap-1 py-1"
                              aria-label="Michelle está escribiendo"
                            >
                              <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--pvx-ink-3)] [animation-delay:-0.3s]" />
                              <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--pvx-ink-3)] [animation-delay:-0.15s]" />
                              <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--pvx-ink-3)]" />
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div
                          className={`${head.length ? "mt-1.5" : "mt-3"} flex gap-2`}
                        >
                          {head.length ? (
                            <span className="w-7 shrink-0" aria-hidden />
                          ) : teamOf(m.content) ? (
                            <span
                              className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--pvx-ink)] text-[12px] font-black text-white"
                              aria-hidden
                            >
                              {teamOf(m.content)!.slice(0, 1)}
                            </span>
                          ) : (
                            <Avatar size={28} />
                          )}
                          <div
                            className={`max-w-[85%] rounded-2xl ${head.length ? "" : "rounded-tl-md"} px-3.5 py-2.5 text-[14.5px] leading-relaxed ${teamOf(m.content) ? "bg-[#fff1e8] ring-1 ring-[var(--pvx-orange)]/30" : "bg-white"}`}
                          >
                            {m.content ? (
                              <>
                                {teamOf(m.content) && !head.length && (
                                  <span className="mb-0.5 block text-[12px] font-bold text-[var(--pvx-orange-text)]">
                                    {teamOf(m.content)} · equipo de Provedix
                                  </span>
                                )}
                                <Rich text={cleanReply(tail)} />
                                {/* La asistente pone la marca solo cuando ya no puede resolver el caso (pedido 2026-10-14):
                            recién ahí aparece el botón a Michelle, la asesora, con la consulta ya escrita. */}
                                {/* Caso para el equipo (2026-10-16: sin WhatsApp, responden aquí mismo). */}
                                {m.content.includes(HANDOFF_MARK) && (
                                  <div className="mt-2.5 rounded-xl bg-[var(--pvx-paper-2)] px-3 py-2.5 text-[13px] leading-snug">
                                    <b>
                                      {caseCodeOf(m.content)
                                        ? `Caso ${caseCodeOf(m.content)} · `
                                        : ""}
                                      El equipo te responde aquí
                                    </b>
                                    <span className="block text-[var(--pvx-ink-2)]">
                                      En {ADVISOR_RESPONSE_PROMISE}, de{" "}
                                      {WORK_HOURS_TEXT}. Vuelve a abrir este
                                      chat para ver la respuesta. Si hace falta,
                                      adjunta fotos o video con 📎.
                                    </span>
                                  </div>
                                )}
                                {photoIdsOf(m.content).map((pid) => (
                                  <a
                                    key={pid}
                                    href={`/api/pvx/chat/photo/${pid}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-2.5 block overflow-hidden rounded-xl border border-[var(--pvx-paper-3)]"
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={`/api/pvx/chat/photo/${pid}`}
                                      alt="Foto de evidencia de tu guía retenida"
                                      className="max-h-72 w-full object-cover"
                                      loading="lazy"
                                    />
                                  </a>
                                ))}
                                {linksOf(m.content).length > 0 && (
                                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                                    {linksOf(m.content).map((k) => (
                                      <a
                                        key={k}
                                        href={PVX_LINKS[k].url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="pvx-press inline-flex items-center gap-1.5 rounded-full border border-[var(--pvx-paper-3)] bg-white px-3.5 py-2 text-[13px] font-bold hover:border-[var(--pvx-orange)]"
                                      >
                                        {PVX_LINKS[k].label} <IconExternal className="w-3.5 h-3.5" />
                                      </a>
                                    ))}
                                  </div>
                                )}
                                {sectionsOf(m.content).length > 0 && (
                                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                                    {sectionsOf(m.content).map((id) => (
                                      <button
                                        key={id}
                                        type="button"
                                        onClick={() => {
                                          setOpen(false);
                                          window.location.hash = id;
                                          document
                                            .getElementById(id)
                                            ?.scrollIntoView({
                                              behavior: "smooth",
                                              block: "start",
                                            });
                                        }}
                                        className="pvx-press inline-flex items-center gap-1.5 rounded-full border border-[var(--pvx-paper-3)] bg-white px-3.5 py-2 text-[13px] font-bold hover:border-[var(--pvx-orange)] cursor-pointer"
                                      >
                                        {SECTION_LABEL[id]}{" "}
                                        <IconArrow className="w-3.5 h-3.5" />
                                      </button>
                                    ))}
                                  </div>
                                )}
                                {actionsOf(m.content).length > 0 && (
                                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                                    {actionsOf(m.content).map((a) =>
                                      a.kind === "FICHA" ? (
                                        // Abre la ficha completa del producto (2026-10-15).
                                        <button
                                          key={a.kind + a.code}
                                          type="button"
                                          onClick={() => {
                                            setOpen(false);
                                            window.dispatchEvent(
                                              new CustomEvent(
                                                PVX_PRODUCT_EVENT,
                                                {
                                                  detail: a.code,
                                                },
                                              ),
                                            );
                                          }}
                                          className="pvx-press inline-flex items-center gap-1.5 rounded-full border border-[var(--pvx-paper-3)] bg-white px-3.5 py-2 text-[13px] font-bold hover:border-[var(--pvx-orange)] cursor-pointer"
                                        >
                                          Ver ficha · {a.code}
                                        </button>
                                      ) : a.kind === "CALC" ? (
                                        // Abre la calculadora de la página con este producto (2026-10-15).
                                        <button
                                          key={a.kind + a.code}
                                          type="button"
                                          onClick={() => {
                                            setOpen(false);
                                            window.dispatchEvent(
                                              new CustomEvent(PVX_CALC_EVENT, {
                                                detail: a.code,
                                              }),
                                            );
                                          }}
                                          className="pvx-press inline-flex items-center gap-1.5 rounded-full bg-[var(--pvx-ink)] px-3.5 py-2 text-[13px] font-bold text-white hover:bg-[#25282f] cursor-pointer"
                                        >
                                          <IconCalc className="w-4 h-4" />{" "}
                                          Calcular mi ganancia · {a.code}
                                        </button>
                                      ) : (
                                        <a
                                          key={a.kind + a.code}
                                          href={`/api/pvx/go/${a.kind.toLowerCase()}/${a.code}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className={`pvx-press inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-bold ${a.kind === "DROPI" ? "bg-[var(--pvx-orange)] text-white hover:bg-[var(--pvx-orange-press)]" : "border border-[var(--pvx-paper-3)] bg-white hover:border-[var(--pvx-orange)]"}`}
                                        >
                                          {ACTION_LABEL[a.kind]} · {a.code}
                                          <IconExternal className="w-3.5 h-3.5" />
                                        </a>
                                      ),
                                    )}
                                  </div>
                                )}
                              </>
                            ) : (
                              <span
                                className="inline-flex gap-1 py-1"
                                aria-label="Michelle está escribiendo"
                              >
                                <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--pvx-ink-3)] [animation-delay:-0.3s]" />
                                <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--pvx-ink-3)] [animation-delay:-0.15s]" />
                                <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--pvx-ink-3)]" />
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </Fragment>
                  );
                })()
              ),
            )}
            {showRegister && !blocked && (
              <PvxChatRegister
                onDone={(name) => {
                  trackChat("chat_register");
                  setRegFlow(false);
                  setTrialLeft(null);
                  onRegistered?.(name);
                  setMessages((m) => [
                    ...m,
                    {
                      role: "assistant",
                      content: `¡Listo, ${name.split(" ")[0]}! 🎉 Ya estás registrado. Ahora sí, pregúntame todo lo que necesites 💛`,
                    },
                  ]);
                  setTimeout(() => inputRef.current?.focus(), 200);
                }}
              />
            )}
            {error && (
              <p
                role="alert"
                className="mt-3 rounded-xl bg-[#fde8e6] px-3 py-2 text-[13px] text-[#a12a1f]"
              >
                {error}
              </p>
            )}
          </div>

          <div className="border-t border-[var(--pvx-paper-3)] px-3 pb-3 pt-2">
            {showRegister && !blocked ? (
              <p className="mt-1 flex items-center justify-center gap-1.5 text-center text-[12.5px] font-semibold text-[var(--pvx-ink-2)]">
                <IconLock className="w-3.5 h-3.5" /> Tus datos están protegidos.
                Completa el registro arriba 👆
              </p>
            ) : blocked ? (
              // Intento de sacar información confidencial: chat cerrado (pedido 2026-10-14).
              <p className="mt-1 rounded-xl bg-[var(--pvx-paper-2)] px-3 py-3 text-center text-[13.5px] font-semibold text-[var(--pvx-ink-2)]">
                {blockedMsg}
              </p>
            ) : (
              <>
                {uploading != null ? (
                  <div className="mb-1.5 flex items-center gap-2 text-[12.5px] font-semibold text-[var(--pvx-ink-2)]">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--pvx-paper-2)]">
                      <span
                        className="block h-full rounded-full bg-[var(--pvx-orange)] transition-all"
                        style={{ width: `${uploading}%` }}
                      />
                    </span>
                    Enviando archivo… {uploading}%
                  </div>
                ) : !registered ? null : (
                  <div className="mb-1.5 flex items-center justify-between gap-2 text-[12.5px] text-[var(--pvx-ink-3)]">
                    {/* El límite se ve antes de adjuntar (2026-10-16). */}
                    <span>
                      📎 Fotos o videos de hasta {MAX_VIDEO_MB} MB (unos 30 s)
                    </span>
                    {remaining != null && (
                      <span className="shrink-0">{remaining} mensajes hoy</span>
                    )}
                  </div>
                )}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    send(input);
                  }}
                  className="flex items-end gap-2"
                >
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,video/webm,video/3gpp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) attach(file);
                    }}
                  />
                  {/* Adjuntar solo con registro (la subida lo exige). */}
                  {registered && (
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      disabled={uploading != null}
                      aria-label="Adjuntar foto o video"
                      title="Adjuntar foto o video"
                      className="pvx-press grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--pvx-paper-2)] text-[var(--pvx-ink-2)] hover:bg-[var(--pvx-paper-3)] disabled:opacity-40 cursor-pointer"
                    >
                      <IconClip />
                    </button>
                  )}
                  <label htmlFor="pvx-chat-input" className="sr-only">
                    Escribe tu pregunta para Michelle
                  </label>
                  <textarea
                    id="pvx-chat-input"
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send(input);
                      }
                    }}
                    rows={1}
                    maxLength={800}
                    disabled={outOfMessages}
                    placeholder={
                      outOfMessages
                        ? "Llegaste al límite de hoy…"
                        : "Escribe aquí tu pregunta…"
                    }
                    className="max-h-28 min-h-[48px] flex-1 resize-none rounded-2xl border-2 border-[var(--pvx-orange)] bg-white px-4 py-3 text-[16px] outline-none placeholder:text-[var(--pvx-ink-2)] focus:shadow-[0_0_0_4px_var(--pvx-orange-soft)] disabled:border-[var(--pvx-paper-3)] disabled:opacity-60"
                  />
                  <button
                    type="submit"
                    disabled={busy || !input.trim() || outOfMessages}
                    aria-label="Enviar"
                    className="pvx-press grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[var(--pvx-orange)] text-white hover:bg-[var(--pvx-orange-press)] disabled:opacity-60 cursor-pointer"
                  >
                    <IconArrow className="w-5 h-5" />
                  </button>
                </form>
              </>
            )}
            <p className="mt-1.5 text-center text-[10.5px] text-[var(--pvx-ink-3)]">
              Michelle es una IA y puede equivocarse · Guardamos el chat para
              atenderte mejor
            </p>
          </div>
        </div>
      )}
    </>
  );
}
