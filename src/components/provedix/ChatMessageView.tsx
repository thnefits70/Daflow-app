"use client";

import { Fragment } from "react";
import { PVX_LINKS, type PvxLinkKey } from "@/lib/pvxLinks";

// Cómo se ve un mensaje del chat de Michelle IA DENTRO de DAFLOW (pedido del
// usuario 2026-10-17: "solo veo palabras, números y asteriscos"). Las
// negritas se ven como negritas y las marcas internas como etiquetas claras
// de lo que vio el dropshipper (botones, caso, foto). Igual que en su chat.

const ACTION_LABEL: Record<string, string> = {
  DROPI: "Ver precio en Dropi",
  CREATIVOS: "Ver creativos",
  LANDING: "Ver landing",
  CALC: "Calcular ganancia",
  FICHA: "Ver ficha",
};
const SECTION_LABEL: Record<string, string> = {
  cortes: "Ver los cortes de hoy",
  recursos: "Rastreo, creativos y garantías",
  calculadora: "Abrir la calculadora",
  productos: "Ver los productos",
  "como-funciona": "Cómo funciona Provedix",
  transportadoras: "Ver qué transportadora entrega mejor",
  preguntas: "Ver preguntas frecuentes",
};

type Chip = { text: string; tone: "button" | "case" | "warn" };

function parse(raw: string) {
  const chips: Chip[] = [];
  const attachments: { id: string; kind: string }[] = [];
  // Varios mensajes cortos (2026-10-17): [[SEP]] separa las partes; aquí van como párrafos.
  let text = raw.replace(/^\[\[EQUIPO:[^\]]+\]\]\s*/, "").replace(/\s*\[\[SEP\]\]\s*/g, "\n\n");
  text = text.replace(/\[\[ADJUNTO:([a-z0-9]{10,40}):(image|video)\]\]/gi, (_m, id: string, kind: string) => {
    attachments.push({ id, kind });
    return "";
  });
  text = text.replace(/\[\[(DROPI|CREATIVOS|LANDING|CALC|FICHA):(\d+)\]\]/g, (_m, k: string, code: string) => {
    chips.push({ text: `${ACTION_LABEL[k] ?? k} · ${code}`, tone: "button" });
    return "";
  });
  text = text.replace(/\[\[IR:([a-z-]+)\]\]/g, (_m, id: string) => {
    chips.push({ text: SECTION_LABEL[id] ?? `Ir a ${id}`, tone: "button" });
    return "";
  });
  text = text.replace(/\[\[ENLACE:([a-z-]+)\]\]/g, (_m, k: string) => {
    chips.push({ text: k in PVX_LINKS ? PVX_LINKS[k as PvxLinkKey].label : `Enlace ${k}`, tone: "button" });
    return "";
  });
  text = text.replace(/\[\[ASESORA(?::([A-Z0-9-]+))?\]\]/g, (_m, code?: string) => {
    chips.push({ text: `Pasó al equipo${code ? ` · caso ${code}` : ""}`, tone: "case" });
    return "";
  });
  text = text.replace(/\[\[FOTO:\w+\]\]/g, () => {
    chips.push({ text: "📸 Foto de la guía retenida", tone: "case" });
    return "";
  });
  text = text.replace(/\[\[BLOQUEAR\]\]/g, () => {
    chips.push({ text: "🔒 Cerró el chat", tone: "warn" });
    return "";
  });
  text = text.replace(/\[\[SOSPECHA\]\]/g, () => {
    chips.push({ text: "⚠️ Le pareció raro (aviso al admin)", tone: "warn" });
    return "";
  });
  return { text: text.trim(), chips, attachments };
}

// **negritas** y saltos de línea; nada de HTML.
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {line.split(/(\*\*[^*]+\*\*)/g).map((part, k) =>
            part.startsWith("**") && part.endsWith("**") ? <b key={k}>{part.slice(2, -2)}</b> : <Fragment key={k}>{part.replace(/\*\*/g, "")}</Fragment>,
          )}
        </Fragment>
      ))}
    </>
  );
}

export function ChatMessageView({ content, dark = false }: { content: string; dark?: boolean }) {
  const { text, chips, attachments } = parse(content);
  return (
    <div>
      {text && <Rich text={text} />}
      {attachments.map((a) =>
        a.kind === "video" ? (
          <video key={a.id} src={`/api/provedix/cases/file/${a.id}`} controls preload="metadata" className="mt-1 max-h-64 w-full rounded-md" />
        ) : (
          <a key={a.id} href={`/api/provedix/cases/file/${a.id}`} target="_blank" rel="noopener noreferrer" className="mt-1 block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/provedix/cases/file/${a.id}`} alt="Foto que adjuntó el dropshipper" className="max-h-64 rounded-md" loading="lazy" />
          </a>
        ),
      )}
      {chips.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {chips.map((c, i) => (
            <span
              key={i}
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                c.tone === "warn"
                  ? "bg-red/10 text-red"
                  : c.tone === "case"
                    ? "bg-teal/15 text-teal"
                    : dark
                      ? "bg-bg/15 text-bg"
                      : "border border-rule bg-cloud text-ink"
              }`}
              title={c.tone === "button" ? "Botón que vio el dropshipper en su chat" : undefined}
            >
              {c.tone === "button" ? "🔘 " : ""}
              {c.text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
