// Corregido 2026-09-23 (Jariel, desde el celular: "Mi área de trabajo no
// me lleva a ningún lado"): sin este archivo, al tocar un enlace a una
// página del área la pantalla no cambiaba NADA hasta que el servidor
// terminaba de armarla — y "Mi área de trabajo" es pesada, así que en datos
// móviles parecía que el toque no hacía nada. Con esto se cambia al
// instante y se ve que está cargando (el menú lateral queda igual).
export default function AreaLoading() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-steel">
      <span className="w-7 h-7 rounded-full border-[3px] border-rule border-t-teal animate-spin" />
      <div className="text-[13px]">Cargando…</div>
    </div>
  );
}
