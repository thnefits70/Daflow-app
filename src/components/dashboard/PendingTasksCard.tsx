"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type PendingItem = { icon: string; label: string; meta: string; overdue: boolean; href: string };
type PendingTasks = { title: string; sub: string; items: PendingItem[] };

// Only ever visible to the person it applies to, and only when they actually
// have something outstanding — see src/lib/pendingTasks.ts for who sees what
// and when something counts as "atrasado".
export function PendingTasksCard() {
  const [data, setData] = useState<PendingTasks | null | undefined>(undefined);

  useEffect(() => {
    fetch("/api/pending-tasks")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => setData(null));
  }, []);

  if (!data) return null;

  return (
    <div className="bg-surface border rounded-lg p-4 mb-6" style={{ borderColor: "rgba(217,164,65,.35)" }}>
      <div className="flex items-center justify-between gap-3 mb-0.5">
        <div className="flex items-center gap-2 text-[13px] font-bold">
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: "#D9A441", boxShadow: "0 0 0 3px rgba(217,164,65,.18)" }}
          />
          {data.title}
        </div>
        <span
          className="font-mono text-[10.5px] font-bold rounded-full px-2.5 py-0.5 border"
          style={{ color: "#D9A441", background: "rgba(217,164,65,.1)", borderColor: "rgba(217,164,65,.35)" }}
        >
          {data.items.length} pendiente{data.items.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="text-[11px] text-steel mb-3">{data.sub}</div>

      <div className="flex flex-col gap-1.5">
        {data.items.map((item, i) => (
          <Link
            key={i}
            href={item.href}
            className={`flex items-center gap-2.5 rounded-md px-3 py-2.5 ${
              item.overdue ? "bg-red/10 border border-red/30" : "bg-cloud"
            }`}
          >
            <span className="text-[14px] w-5 text-center shrink-0">{item.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-semibold">{item.label}</div>
              <div className={`text-[10.5px] mt-0.5 ${item.overdue ? "text-red" : "text-steel"}`}>{item.meta}</div>
            </div>
            <span className="text-[11px] font-bold text-blue shrink-0">Ir →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
