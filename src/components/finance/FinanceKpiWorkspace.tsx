"use client";

import { useState } from "react";
import { FinanceDashboard } from "./FinanceDashboard";
import { FinanceUploadPanel } from "./FinanceUploadPanel";
import type { FinanceKpiDataDTO } from "@/lib/financeKpis";

// Owns the Dashboard / Cargar plantilla sub-tab, nested inside the existing
// "KPIs financieros" top-level tab — DeptWorkspaceTabs itself stays a flat
// single-level tab bar, this component is the one exception with its own
// local sub-navigation, per the approved design.
export function FinanceKpiWorkspace({
  deptId,
  data,
  editable,
}: {
  deptId: string;
  data: FinanceKpiDataDTO;
  editable: boolean;
}) {
  const [subTab, setSubTab] = useState<"dashboard" | "plantilla">("dashboard");

  return (
    <div>
      <div className="flex gap-2 mb-5">
        <button
          type="button"
          className={`px-4 py-2 text-[12.5px] font-semibold rounded-t-md border border-b-0 cursor-pointer ${
            subTab === "dashboard" ? "bg-surface text-ink border-rule" : "bg-cloud text-steel border-rule"
          }`}
          onClick={() => setSubTab("dashboard")}
        >
          📊 Dashboard
        </button>
        {editable && (
          <button
            type="button"
            className={`px-4 py-2 text-[12.5px] font-semibold rounded-t-md border border-b-0 cursor-pointer ${
              subTab === "plantilla" ? "bg-surface text-ink border-rule" : "bg-cloud text-steel border-rule"
            }`}
            onClick={() => setSubTab("plantilla")}
          >
            📤 Cargar plantilla
          </button>
        )}
      </div>

      {subTab === "dashboard" && <FinanceDashboard deptId={deptId} data={data} editable={editable} />}
      {subTab === "plantilla" && editable && <FinanceUploadPanel deptId={deptId} data={data} />}
    </div>
  );
}
