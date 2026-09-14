import { useEffect, useRef } from "react";

// Guardado automático y silencioso de un formulario en progreso, para que un
// colaborador que sale a revisar otra pantalla de DAFLOW antes de terminar
// no pierda lo que ya había llenado al volver. Ver src/app/api/form-drafts.
//
// - `key`: identifica el formulario (y el registro puntual si aplica, ej.
//   `external-sale-edit:${saleId}`). Pasar `null` desactiva el hook (ej.
//   mientras el registro puntual todavía no se conoce).
// - `value`: los datos actuales del formulario a respaldar.
// - `onRestore`: se llama una sola vez, al montar, si había un borrador
//   guardado — para volcarlo de vuelta a los estados del formulario.
// - `isEmpty`: para no guardar (ni pisar un borrador previo) un formulario
//   que todavía no tiene nada útil escrito.
// - `label`/`resumeUrl`: opcionales — si se pasan, este borrador también
//   aparece como pendiente en Inicio (ver /api/form-drafts/mine) con ese
//   texto y ese link para "Continuar". Sin ellos, el borrador se sigue
//   restaurando bien dentro de su propia pantalla, solo que no aparece ahí.
export function useFormDraft<T>(
  key: string | null,
  value: T,
  onRestore: (data: T) => void,
  isEmpty: (data: T) => boolean,
  label?: string,
  resumeUrl?: string
) {
  const fetchedForKeyRef = useRef<string | null>(null);
  // Solo queda === key una vez que el GET de restauración terminó (con o sin
  // borrador) — así el autoguardado nunca pisa un borrador real con el
  // valor "recién montado, todavía sin restaurar" mientras el GET viaja.
  const restoredKeyRef = useRef<string | null>(null);
  const onRestoreRef = useRef(onRestore);
  useEffect(() => {
    onRestoreRef.current = onRestore;
  }, [onRestore]);

  useEffect(() => {
    if (!key || fetchedForKeyRef.current === key) return;
    fetchedForKeyRef.current = key;
    fetch(`/api/form-drafts?key=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.data !== null && d?.data !== undefined) onRestoreRef.current(d.data as T);
      })
      .catch(() => {})
      .finally(() => {
        restoredKeyRef.current = key;
      });
  }, [key]);

  useEffect(() => {
    if (!key || restoredKeyRef.current !== key) return;
    const empty = isEmpty(value);
    const timer = setTimeout(() => {
      if (empty) {
        fetch(`/api/form-drafts?key=${encodeURIComponent(key)}`, { method: "DELETE" }).catch(() => {});
      } else {
        fetch("/api/form-drafts", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, data: value, label, resumeUrl }),
        }).catch(() => {});
      }
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, JSON.stringify(value), label, resumeUrl]);

  function clearDraft() {
    if (!key) return;
    fetch(`/api/form-drafts?key=${encodeURIComponent(key)}`, { method: "DELETE" }).catch(() => {});
  }

  return { clearDraft };
}
