"use client";

import { useB2BAdvisorLabel } from "@/lib/useB2BAdvisorLabel";

// "la asesora B2B" / "el asesor B2B" dentro de un texto (antes decía
// "Heidy"). capital: con mayúscula inicial, para empezar una frase.
export function B2BAdvisorName({ capital = false }: { capital?: boolean }) {
  const { the, The } = useB2BAdvisorLabel();
  return <>{capital ? The : the}</>;
}
