"use client";

export function FinancialAnalysis({ good, improve }: { good: string[]; improve: string[] }) {
  if (good.length === 0 && improve.length === 0) {
    return <div className="text-steel text-[12.5px]">Carga al menos dos meses para generar un análisis.</div>;
  }
  return (
    <div>
      <div className="mb-4">
        <div className="font-mono text-[10.5px] uppercase tracking-wide font-bold mb-2 text-teal">🎉 Lo que va bien</div>
        <ul className="list-disc pl-4.5 space-y-1">
          {good.map((line, i) => <li key={i} className="text-[12.5px] leading-relaxed">{line}</li>)}
        </ul>
      </div>
      <div>
        <div className="font-mono text-[10.5px] uppercase tracking-wide font-bold mb-2" style={{ color: "#D9A441" }}>🔧 Por mejorar / atender</div>
        <ul className="list-disc pl-4.5 space-y-1">
          {improve.map((line, i) => <li key={i} className="text-[12.5px] leading-relaxed">{line}</li>)}
        </ul>
      </div>
      <div className="mt-3 pt-3 border-t border-dashed border-rule text-[11px] text-steel">
        💡 Esto es un apoyo informativo para orientar la conversación — no sustituye la revisión de tu contadora ni de tu abogado.
      </div>
    </div>
  );
}
