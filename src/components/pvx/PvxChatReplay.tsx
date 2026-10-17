"use client";

import { Saira } from "next/font/google";
import "@/app/pvx/pvx.css";
import {
  ACTION_LABEL,
  attachmentsOf,
  Avatar,
  caseCodeOf,
  cleanReply,
  HANDOFF_MARK,
  photoIdsOf,
  Rich,
  SECTION_LABEL,
  sectionsOf,
  teamOf,
  actionsOf,
} from "@/components/pvx/PvxChat";
import { IconArrow, IconCalc, IconClose, IconExternal } from "@/components/pvx/PvxIcons";
import { ADVISOR_RESPONSE_PROMISE, WORK_HOURS_TEXT } from "@/lib/pvxFaq";

// "Ver como el dropshipper" (pedido del usuario 2026-10-17): el admin abre una
// conversación en la MISMA ventana de Michelle IA de provedix.com (letra,
// colores, burbujas, botones, fotos), solo para leer, y ajusta lo que falte.
// Los botones abren lo mismo que le abrieron al dropshipper.

const saira = Saira({ subsets: ["latin", "latin-ext"], style: ["normal", "italic"], axes: ["wdth"], variable: "--font-pvx", display: "swap" });

const SITE = "https://provedix.com";

type Msg = { role: string; content: string; at: string };

function when(iso: string) {
  return new Date(iso).toLocaleString("es-EC", { timeZone: "America/Guayaquil", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function PvxChatReplay({ messages, name, onClose }: { messages: Msg[]; name: string; onClose: () => void }) {
  const first = name.trim().split(/\s+/)[0] ?? "";
  const shown = messages.filter((m) => m.role === "user" || m.role === "assistant");
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-3" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`Conversación de ${name} como la vio en provedix.com`}
        onClick={(e) => e.stopPropagation()}
        className={`pvx ${saira.variable} flex h-[min(92dvh,700px)] w-full max-w-[400px] flex-col overflow-hidden rounded-[26px] bg-white text-[var(--pvx-ink)] shadow-2xl`}
      >
        <div className="flex items-center gap-3 bg-[var(--pvx-night)] px-4 py-3 text-white">
          <Avatar />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-bold">Michelle</div>
            <div className="text-[12px] text-white/65">Asistente virtual de Provedix · responde con IA</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="grid h-9 w-9 place-items-center rounded-full bg-white/10 hover:bg-white/20 cursor-pointer">
            <IconClose className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain bg-[var(--pvx-paper-2)] px-3 py-4">
          {/* Saludo que vio al abrir el chat (no se guarda en la conversación). */}
          <div className="flex gap-2">
            <Avatar size={28} />
            <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-white px-3.5 py-2.5 text-[14.5px] leading-relaxed">
              ¡Hola{first ? `, ${first}` : ""}! 👋 Soy <b>Michelle</b>, tu asistente virtual de Provedix 😊 Estoy aquí para ayudarte a encontrar productos ganadores, ver
              cuánto se venden y resolver tus dudas. Cuéntame, ¿en qué te ayudo hoy? 💛
            </div>
          </div>

          {shown.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="mt-3 flex flex-col items-end">
                {attachmentsOf(m.content).length > 0 ? (
                  <div className="w-[70%] max-w-[260px]">
                    {attachmentsOf(m.content).map((a) =>
                      a.kind === "video" ? (
                        <video key={a.id} src={`/api/provedix/cases/file/${a.id}`} controls preload="metadata" className="mt-1 max-h-72 w-full rounded-xl bg-black" />
                      ) : (
                        <a key={a.id} href={`/api/provedix/cases/file/${a.id}`} target="_blank" rel="noopener noreferrer" className="mt-1 block overflow-hidden rounded-xl">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/provedix/cases/file/${a.id}`} alt="Foto que mandó el dropshipper" className="max-h-72 w-full object-cover" />
                        </a>
                      ),
                    )}
                  </div>
                ) : (
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-md bg-[var(--pvx-ink)] px-3.5 py-2.5 text-[14.5px] leading-relaxed text-white">
                    {m.content}
                  </div>
                )}
                <span className="mt-0.5 text-[11px] text-[var(--pvx-ink-3)]">{when(m.at)}</span>
              </div>
            ) : (
              <div key={i} className="mt-3 flex gap-2">
                {teamOf(m.content) ? (
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--pvx-ink)] text-[12px] font-black text-white" aria-hidden>
                    {teamOf(m.content)!.slice(0, 1)}
                  </span>
                ) : (
                  <Avatar size={28} />
                )}
                <div className="max-w-[85%]">
                  <div
                    className={`rounded-2xl rounded-tl-md px-3.5 py-2.5 text-[14.5px] leading-relaxed ${teamOf(m.content) ? "bg-[#fff1e8] ring-1 ring-[var(--pvx-orange)]/30" : "bg-white"}`}
                  >
                    {teamOf(m.content) && <span className="mb-0.5 block text-[12px] font-bold text-[var(--pvx-orange-text)]">{teamOf(m.content)} · equipo de Provedix</span>}
                    <Rich text={cleanReply(m.content)} />
                    {m.content.includes(HANDOFF_MARK) && (
                      <div className="mt-2.5 rounded-xl bg-[var(--pvx-paper-2)] px-3 py-2.5 text-[13px] leading-snug">
                        <b>
                          {caseCodeOf(m.content) ? `Caso ${caseCodeOf(m.content)} · ` : ""}
                          El equipo te responde aquí
                        </b>
                        <span className="block text-[var(--pvx-ink-2)]">
                          En {ADVISOR_RESPONSE_PROMISE}, de {WORK_HOURS_TEXT}. Vuelve a abrir este chat para ver la respuesta. Si hace falta, adjunta fotos o video con 📎.
                        </span>
                      </div>
                    )}
                    {photoIdsOf(m.content).map((pid) => (
                      <div key={pid} className="mt-2.5 rounded-xl border border-[var(--pvx-paper-3)] px-3 py-2 text-[13px]">
                        📸 Foto de la guía retenida (la vio el dropshipper)
                      </div>
                    ))}
                    {sectionsOf(m.content).length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {sectionsOf(m.content).map((id) => (
                          <a
                            key={id}
                            href={`${SITE}/#${id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--pvx-paper-3)] bg-white px-3.5 py-2 text-[13px] font-bold hover:border-[var(--pvx-orange)]"
                          >
                            {SECTION_LABEL[id]} <IconArrow className="w-3.5 h-3.5" />
                          </a>
                        ))}
                      </div>
                    )}
                    {actionsOf(m.content).length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {actionsOf(m.content).map((a) =>
                          a.kind === "FICHA" ? (
                            <a
                              key={a.kind + a.code}
                              href={`${SITE}/#productos`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--pvx-paper-3)] bg-white px-3.5 py-2 text-[13px] font-bold hover:border-[var(--pvx-orange)]"
                            >
                              Ver ficha · {a.code}
                            </a>
                          ) : a.kind === "CALC" ? (
                            <a
                              key={a.kind + a.code}
                              href={`${SITE}/calculadora`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--pvx-ink)] px-3.5 py-2 text-[13px] font-bold text-white"
                            >
                              <IconCalc className="w-4 h-4" /> Calcular mi ganancia · {a.code}
                            </a>
                          ) : (
                            <a
                              key={a.kind + a.code}
                              href={`${SITE}/api/pvx/go/${a.kind.toLowerCase()}/${a.code}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-bold ${a.kind === "DROPI" ? "bg-[var(--pvx-orange)] text-white" : "border border-[var(--pvx-paper-3)] bg-white hover:border-[var(--pvx-orange)]"}`}
                            >
                              {ACTION_LABEL[a.kind]} · {a.code}
                              <IconExternal className="w-3.5 h-3.5" />
                            </a>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                  <span className="mt-0.5 block text-[11px] text-[var(--pvx-ink-3)]">{when(m.at)}</span>
                </div>
              </div>
            ),
          )}
        </div>

        <div className="border-t border-[var(--pvx-paper-3)] bg-white px-3 py-2.5 text-center text-[12.5px] font-semibold text-[var(--pvx-ink-2)]">
          👀 Solo lectura · así lo vio {first || "el dropshipper"} en provedix.com
        </div>
      </div>
    </div>
  );
}
