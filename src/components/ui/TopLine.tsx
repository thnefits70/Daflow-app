export function TopLine({ eyebrow, title, action }: { eyebrow: string; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-2.5 mb-6.5">
      <div>
        <div className="font-mono text-[10.5px] tracking-[.14em] uppercase text-steel">{eyebrow}</div>
        <h2 className="font-display text-[24px] mt-0.5">{title}</h2>
      </div>
      {action}
    </div>
  );
}
