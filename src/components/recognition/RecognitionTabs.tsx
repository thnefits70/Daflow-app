"use client";

import { useState, type ReactNode } from "react";

export function RecognitionTabs({ tabs }: { tabs: { key: string; label: string; content: ReactNode }[] }) {
  const [active, setActive] = useState(tabs[0]?.key);
  return (
    <div>
      <div className="flex items-center gap-1 border-b border-rule mb-5">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`px-4 py-2.5 text-[13px] font-semibold cursor-pointer border-b-2 -mb-px ${
              active === t.key ? "border-blue text-ink" : "border-transparent text-steel hover:text-ink"
            }`}
            onClick={() => setActive(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.find((t) => t.key === active)?.content}
    </div>
  );
}
