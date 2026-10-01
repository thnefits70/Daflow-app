"use client";

import { useEffect, useState } from "react";
import { DEFAULT_B2B_ADVISOR_TITLE, b2bAdvisorWithArticle } from "@/lib/b2bAdvisorRoleShared";

// Texto del rol Asesor(a) B2B para pantallas de cliente: { the: "la asesora
// B2B", The: "La asesora B2B" } (o "el asesor B2B" si lo tiene un hombre).
// Una sola consulta por carga de página, compartida entre componentes.
let cached: string | null = null;
let inflight: Promise<string> | null = null;

function load(): Promise<string> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = fetch("/api/b2b-advisor-title")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (cached = d?.title || DEFAULT_B2B_ADVISOR_TITLE))
      .catch(() => DEFAULT_B2B_ADVISOR_TITLE);
  }
  return inflight;
}

export function useB2BAdvisorLabel() {
  const [title, setTitle] = useState<string>(cached || DEFAULT_B2B_ADVISOR_TITLE);
  useEffect(() => {
    let alive = true;
    load().then((t) => alive && setTitle(t));
    return () => {
      alive = false;
    };
  }, []);
  const the = b2bAdvisorWithArticle(title);
  return { title, the, The: the.charAt(0).toUpperCase() + the.slice(1) };
}
