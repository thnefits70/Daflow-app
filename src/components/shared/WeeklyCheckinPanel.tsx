"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ClipboardList, MessageCircleQuestion, Send, X, Mic, MicOff, Paperclip } from "lucide-react";
import { useDictation } from "@/lib/useDictation";
import { compressImage } from "@/lib/compressImage";

type ChatMessage = { role: "user" | "assistant"; content: string };
type PendingImage = { url: string; mediaType: string; data: string };

// Imágenes para Mary (pedido de Daniel 2026-10-07): se achican acá, viajan
// solo con el mensaje en que se envían y NUNCA se guardan — en el historial
// queda solo el texto "📷 Imagen adjunta". Mismos límites que el servidor
// (MARY_MAX_IMAGES / MARY_MAX_IMAGE_BASE64 en maryHelp.ts).
const MAX_IMAGES = 3;
const MAX_IMAGE_BASE64 = 1_300_000;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Widget flotante del asistente de check-in semanal — reemplaza la reunión
// 1:1 admin-líder (ver src/lib/weeklyCheckin.ts). A diferencia de Nancy (que
// vive solo en la pantalla de KPIs financieros y maneja muchas
// conversaciones guardadas), este widget se monta para el LÍDER de un área
// con bitácora semanal (nunca para el resto del equipo, ver area/layout.tsx)
// y solo tiene UNA conversación activa a la vez — la de la semana en curso —
// así que no necesita props ni una vista de "lista".
// Posición bottom-left por defecto (Nancy usa bottom-right) para no chocar
// si alguien llega a ver ambos widgets; se puede arrastrar a la derecha.
//
// `embedded` (pedido explícito del usuario 2026-09-22): cuando un líder
// lleva 3+ semanas sin gestión, WeeklyCheckinFullLockGate.tsx reutiliza
// este mismo componente en modo incrustado — sin botón flotante, sin modal,
// sin poder cerrarlo — como la ÚNICA cosa que puede hacer en toda la
// cuenta. Misma lógica de chat/streaming/dictado que el widget flotante;
// solo cambia el envoltorio visual.
//
// `mode="help"` (pedido del usuario 2026-10-01): Mary también es la guía de
// DAFLOW para quien NO es líder — mismo widget, pero habla con
// /api/mary-help (solo guía, sin registrar nada) y la conversación vive en
// sessionStorage en vez de la base. Los líderes le preguntan lo mismo
// dentro de su chat de Feedback semanal. En ambos modos el nombre "Mary" se
// ve en el encabezado y sobre cada respuesta suya.
const HELP_STORAGE_KEY = "mary-help-chat";
// Pedido del usuario 2026-10-03: en celular el botón flotante tapaba
// opciones de la esquina inferior izquierda — se puede arrastrar a la otra
// esquina inferior y se queda ahí (por dispositivo, localStorage).
const SIDE_STORAGE_KEY = "mary-fab-side";
const DRAG_THRESHOLD = 8;

export function WeeklyCheckinPanel({ embedded = false, mode = "checkin" }: { embedded?: boolean; mode?: "checkin" | "help" } = {}) {
  const isHelp = mode === "help";
  const endpoint = isHelp ? "/api/mary-help" : "/api/weekly-checkin";
  const title = isHelp ? "Mary · Guía de DAFLOW" : "Mary · Feedback semanal";
  const HeaderIcon = isHelp ? MessageCircleQuestion : ClipboardList;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [side, setSide] = useState<"left" | "right">("left");
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<PendingImage[]>([]);
  const dictation = useDictation(input, setInput);
  const { listening, supported: micSupported } = dictation;
  const stopDictation = dictation.stop;

  // Accesos directos (ej. la tarjeta de Inicio, "?openMary=1") deben abrir
  // el chat en un solo clic, sin que la persona tenga que buscar el botón
  // flotante — confirmado 2026-08-31, pedido explícito del usuario.
  // Depende de `searchParams` (no un efecto de una sola vez): este widget
  // vive en el layout y NO se remonta al navegar de /area a /area de
  // nuevo con otra query — sin esta dependencia, un segundo clic en el
  // mismo accesos directo no vuelve a abrir el chat.
  useEffect(() => {
    if (searchParams.get("openMary") === "1") setOpen(true);
  }, [searchParams]);

  // "Assume default, flip after mount" — same pattern used in NancyPanel and
  // WeeklyTrendChart — keeps the server-rendered markup identical to the
  // first client render (matchMedia doesn't exist on server).
  useEffect(() => {
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    try {
      if (localStorage.getItem(SIDE_STORAGE_KEY) === "right") setSide("right");
    } catch {
      // Sin almacenamiento: queda en la esquina por defecto.
    }
  }, []);

  function onFabPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    dragStartRef.current = { x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onFabPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const start = dragStartRef.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    start.moved = true;
    setDrag({ dx, dy });
  }

  // Al soltar, se pega a la esquina inferior más cercana (izq./der.).
  function onFabPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    if (!start?.moved) return;
    suppressClickRef.current = true;
    setDrag(null);
    const next = e.clientX < window.innerWidth / 2 ? "left" : "right";
    setSide(next);
    try {
      localStorage.setItem(SIDE_STORAGE_KEY, next);
    } catch {
      // Sin almacenamiento: la posición vale solo para esta visita.
    }
  }

  function onFabPointerCancel() {
    dragStartRef.current = null;
    setDrag(null);
  }

  // Al cerrar el chat se apaga el micrófono (el botón flotante sigue montado).
  useEffect(() => {
    if (!open && !embedded) stopDictation();
  }, [open, embedded, stopDictation]);

  useEffect(() => {
    if ((!open && !embedded) || loadedOnce) return;
    (async () => {
      if (isHelp) {
        let saved: ChatMessage[] = [];
        try {
          saved = JSON.parse(sessionStorage.getItem(HELP_STORAGE_KEY) ?? "[]");
        } catch {
          // sessionStorage bloqueado/vacío: arranca sin historial.
        }
        setMessages(Array.isArray(saved) ? saved : []);
      } else {
        const res = await fetch("/api/weekly-checkin");
        if (res.ok) {
          const data = await res.json();
          setMessages(data.messages ?? []);
        }
      }
      setLoadedOnce(true);
    })();
  }, [open, embedded, loadedOnce, isHelp]);

  useEffect(() => {
    if (!isHelp || !loadedOnce || loading) return;
    try {
      sessionStorage.setItem(HELP_STORAGE_KEY, JSON.stringify(messages.slice(-30)));
    } catch {
      // Sin almacenamiento disponible: el chat sigue funcionando sin guardar.
    }
  }, [isHelp, loadedOnce, loading, messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function addImages(files: File[]) {
    setError(null);
    const room = MAX_IMAGES - images.length;
    if (room <= 0) {
      setError(`Máximo ${MAX_IMAGES} imágenes por mensaje.`);
      return;
    }
    const added: PendingImage[] = [];
    for (const original of files.filter((f) => f.type.startsWith("image/")).slice(0, room)) {
      const file = await compressImage(original, 1568, 0.8);
      if (!IMAGE_TYPES.includes(file.type)) {
        setError("Ese tipo de imagen no se puede enviar. Usa una foto o captura (JPG o PNG).");
        continue;
      }
      const url = await readAsDataUrl(file).catch(() => null);
      const data = url?.split(",")[1] ?? "";
      if (!url || !data) {
        setError("No se pudo leer la imagen. Intenta con otra.");
        continue;
      }
      if (data.length > MAX_IMAGE_BASE64) {
        setError("La imagen es muy pesada. Envía una captura de pantalla en vez de la foto original.");
        continue;
      }
      added.push({ url, mediaType: file.type, data });
    }
    if (added.length) setImages((prev) => [...prev, ...added].slice(0, MAX_IMAGES));
  }

  async function send() {
    const text = input.trim();
    if ((!text && images.length === 0) || loading) return;
    stopDictation();
    setError(null);
    const sentImages = images;
    const imageNote = sentImages.length === 1 ? "📷 Imagen adjunta" : sentImages.length > 1 ? `📷 ${sentImages.length} imágenes adjuntas` : "";
    const content = [text, imageNote].filter(Boolean).join("\n\n");
    // Burbujas vacías (respuesta de Mary que llegó en blanco) no se reenvían.
    const nextMessages: ChatMessage[] = [...messages.filter((m) => m.content.trim()), { role: "user" as const, content }].slice(isHelp ? -30 : -40);
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    setInput("");
    setImages([]);
    setLoading(true);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          images: sentImages.length ? sentImages.map((img) => ({ mediaType: img.mediaType, data: img.data })) : undefined,
        }),
      });
      if (!res.ok || !res.body) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || "Error al contactar al asistente.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        const finalText = acc;
        setMessages((prev) => {
          const copy = prev.slice();
          copy[copy.length - 1] = { role: "assistant", content: finalText };
          return copy;
        });
      }
      // El registro (si el asistente ya tenía lo necesario) quedó guardado
      // del lado del servidor — refresca la página para que la bitácora de
      // Feedback semanal del líder lo vea sin recargar manualmente.
      if (!isHelp) router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al contactar al asistente.");
      setMessages((prev) => prev.slice(0, -1));
      // Las imágenes no quedan guardadas en ningún lado: si falló, se
      // devuelven al campo para reenviarlas sin volver a elegirlas.
      if (sentImages.length) {
        setImages(sentImages);
        setInput(text);
      }
    } finally {
      setMessages((prev) => prev.filter((m) => m.content.trim()));
      setLoading(false);
    }
  }

  // Cuerpo del chat compartido entre el widget flotante y el modo
  // incrustado (embedded) — mismo mensaje/input/dictado, solo cambia el
  // envoltorio (modal con header+cerrar vs. contenedor fijo sin salida).
  const chatBody = (
    <>
      <div className="flex-1 overflow-y-auto px-5 py-4 min-h-[320px]">
        {messages.length === 0 && (
          <div className="text-[13.5px] text-steel">
            {isHelp
              ? "Hola, soy Mary. Pregúntame dónde encontrar algo en DAFLOW o cómo se hace, y te guío paso a paso con lo que tienes en tu usuario."
              : "Hola, soy Mary. Cuéntame qué problemas tuviste esta semana y armamos juntos el plan para resolverlos. También puedes preguntarme dónde encontrar algo en DAFLOW."}
          </div>
        )}
        <div className="space-y-3">
          {messages.map((m, i) => (
            <div key={i} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
              {m.role === "assistant" && <div className="text-[10.5px] font-semibold text-teal mb-0.5 ml-0.5">Mary</div>}
              <div
                className={`max-w-[80%] rounded-md px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap ${
                  m.role === "user" ? "bg-blue text-white" : "bg-cloud border border-rule text-ink"
                }`}
              >
                {m.content || (loading && i === messages.length - 1 ? "…" : "")}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {error && <div className="px-5 text-[11.5px] text-red">{error}</div>}

      <div className="px-5 pt-3 pb-4 border-t border-rule shrink-0">
        {images.length > 0 && (
          <div className="flex gap-2 mb-2.5 flex-wrap">
            {images.map((img, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- vista previa local (data URL), nunca se sube */}
                <img src={img.url} alt={`Imagen ${i + 1}`} className="w-16 h-16 object-cover rounded border border-rule" />
                <button
                  type="button"
                  title="Quitar imagen"
                  aria-label="Quitar imagen"
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-navy text-white flex items-center justify-center cursor-pointer"
                  onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                  disabled={loading}
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length) addImages(files);
          }}
        />
        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 rounded border border-rule bg-cloud px-3 py-2.5 text-[13.5px] min-w-0"
            placeholder={listening ? "Escuchando..." : isHelp ? "Pregúntale a Mary..." : "Escribe o dicta tu respuesta..."}
            value={input}
            onChange={(e) => dictation.onManualEdit(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
              if (files.length) {
                e.preventDefault();
                addImages(files);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            disabled={loading}
          />
          <button
            type="button"
            title="Adjuntar imagen"
            aria-label="Adjuntar imagen"
            className="px-2.5 py-2 rounded-md border border-rule text-steel hover:text-ink shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading || images.length >= MAX_IMAGES}
          >
            <Paperclip size={15} />
          </button>
          {micSupported && (
            <button
              type="button"
              title={listening ? "Detener dictado" : "Dictar por voz"}
              className={`px-2.5 py-2 rounded-md border shrink-0 cursor-pointer ${
                listening ? "bg-red/20 border-red text-red" : "border-rule text-steel hover:text-ink"
              } ${listening && !reducedMotion ? "animate-pulse" : ""}`}
              onClick={dictation.toggle}
              disabled={loading}
            >
              {listening ? <MicOff size={15} /> : <Mic size={15} />}
            </button>
          )}
          <button
            type="button"
            className="px-3.5 py-2 rounded-md bg-teal text-navy font-semibold text-[12.5px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0"
            onClick={send}
            disabled={loading || (!input.trim() && images.length === 0)}
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </>
  );

  if (embedded) {
    return (
      <div
        className="flex-1 min-h-0 flex flex-col bg-surface border border-rule rounded-md shadow-sm"
        role="dialog"
        aria-label={title}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-rule shrink-0">
          <HeaderIcon size={15} className="text-teal shrink-0" />
          <div className="font-mono text-[10px] uppercase tracking-wide text-steel font-bold truncate">{title}</div>
        </div>
        {chatBody}
      </div>
    );
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center bg-navy/60 px-4"
          onClick={() => setOpen(false)}
        >
        <div
          className="w-[min(680px,94vw)] max-h-[82vh] flex flex-col bg-surface border border-rule rounded-md shadow-2xl"
          role="dialog"
          aria-label={title}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-rule shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <HeaderIcon size={15} className="text-teal shrink-0" />
              <div className="font-mono text-[10px] uppercase tracking-wide text-steel font-bold truncate">{title}</div>
            </div>
            <button type="button" title="Cerrar" className="p-1.5 rounded text-steel hover:text-ink cursor-pointer" onClick={() => setOpen(false)}>
              <X size={15} />
            </button>
          </div>
          {chatBody}
        </div>
        </div>
      )}

      <button
        type="button"
        className={`fixed bottom-5 ${side === "left" ? "left-5" : "right-5"} z-[150] w-13 h-13 rounded-full bg-teal text-navy shadow-2xl cursor-pointer flex items-center justify-center hover:brightness-110 select-none ${drag ? "opacity-80" : ""}`}
        style={{
          width: 52,
          height: 52,
          touchAction: "none",
          transform: drag ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined,
        }}
        title={`${isHelp ? "Pregúntale a Mary" : "Mary · Feedback semanal"} (arrástrame a la otra esquina)`}
        aria-label={isHelp ? "Pregúntale a Mary" : "Mary · Feedback semanal"}
        onPointerDown={onFabPointerDown}
        onPointerMove={onFabPointerMove}
        onPointerUp={onFabPointerUp}
        onPointerCancel={onFabPointerCancel}
        onClick={() => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          setOpen((v) => !v);
        }}
      >
        {open ? <X size={22} /> : <HeaderIcon size={22} />}
      </button>
    </>
  );
}
