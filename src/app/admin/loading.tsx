// 2026-09-30: al tocar "DAFLOW" arriba (celular) para volver al Inicio, sin
// este archivo la pantalla no cambiaba hasta que el servidor terminaba de
// armar la página — parecía que el toque no hacía nada. Igual que
// area/loading.tsx: cambia al instante y muestra que está cargando.
export default function AdminLoading() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-steel">
      <span className="w-7 h-7 rounded-full border-[3px] border-rule border-t-teal animate-spin" />
      <div className="text-[13px]">Cargando…</div>
    </div>
  );
}
