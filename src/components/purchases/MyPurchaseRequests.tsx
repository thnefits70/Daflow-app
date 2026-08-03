"use client";

import { useEffect, useState } from "react";
import { FileText, Upload } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { compressImage } from "@/lib/compressImage";
import { usePasteFile } from "@/lib/usePasteFile";

type Row = {
  id: string;
  groupId: string;
  status: "PENDING_APPROVAL" | "REJECTED" | "APPROVED" | "PAID" | "RECEIVED";
  quantity: number;
  totalCost: number;
  requestedAt: string;
  rejectReason: string | null;
  catalogItem: { name: string };
  invoiceStatus: string;
  purchaseOrderUrl: string | null;
};

const STEPS: { key: Row["status"]; label: string }[] = [
  { key: "PENDING_APPROVAL", label: "Enviado" },
  { key: "APPROVED", label: "Aprobado" },
  { key: "PAID", label: "Pagado" },
  { key: "RECEIVED", label: "Recibido" },
];

function stepIndex(status: Row["status"]) {
  if (status === "REJECTED") return -1;
  return STEPS.findIndex((s) => s.key === status);
}

function groupRows(rows: Row[]) {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    if (!map.has(r.groupId)) map.set(r.groupId, []);
    map.get(r.groupId)!.push(r);
  }
  return [...map.values()];
}

function GroupCard({ g, onPurchaseOrderUploaded }: { g: Row[]; onPurchaseOrderUploaded: (groupId: string, url: string) => void }) {
  const groupId = g[0].groupId;
  const total = g.reduce((s, r) => s + r.totalCost, 0);
  const rejected = g[0].status === "REJECTED";
  const needsPurchaseOrder = !rejected && !g[0].purchaseOrderUrl;
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const { onPaste, onMouseEnter: onPasteHoverIn, onMouseLeave: onPasteHoverOut } = usePasteFile((file) => handleFile(file));

  // Si un grupo tiene varios productos, cada uno puede llegar por separado
  // (Inventario confirma producto por producto) — el avance general muestra
  // el paso MÁS ATRASADO de todos.
  const groupIdx = Math.min(...g.map((r) => stepIndex(r.status)));
  const statusesDiffer = new Set(g.map((r) => r.status)).size > 1;

  async function handleFile(file: File) {
    setUploading(true);
    setErr("");
    const compressed = await compressImage(file);
    const uploaded = await uploadFile(compressed, "purchase-orders");
    if (!uploaded.ok) {
      setUploading(false);
      setErr(uploaded.error);
      return;
    }
    const res = await fetch(`/api/purchase-requests/group/${groupId}/purchase-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purchaseOrderUrl: uploaded.url }),
    });
    setUploading(false);
    if (!res.ok) {
      setErr("No se pudo guardar la orden de compra.");
      return;
    }
    onPurchaseOrderUploaded(groupId, uploaded.url);
  }

  return (
    <div className={`bg-surface border rounded-md p-4 ${needsPurchaseOrder ? "border-gold/40" : "border-rule"}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2.5">
        <div>
          {g.map((r) => (
            <div key={r.id} className="text-[13.5px] font-bold">
              {r.catalogItem.name} · {r.quantity} un.
              {statusesDiffer && !rejected && (
                <span className="ml-2 text-[10.5px] font-semibold text-steel">— {STEPS[stepIndex(r.status)]?.label ?? r.status}</span>
              )}
            </div>
          ))}
          <div className="text-[11.5px] text-steel">${total.toFixed(2)} · {new Date(g[0].requestedAt).toLocaleDateString("es-MX")}</div>
        </div>
      </div>
      {rejected ? (
        <div className="text-[12px] text-red">Rechazada{g[0].rejectReason ? ` — ${g[0].rejectReason}` : ""}</div>
      ) : (
        <div className="flex gap-1.5">
          {STEPS.map((s, i) => (
            <div key={s.key} className={`flex-1 rounded-md py-1.5 text-center text-[10.5px] font-semibold border ${i <= groupIdx ? "border-green/45 text-green bg-green/10" : "border-rule text-steel bg-cloud"}`}>
              {s.label}
            </div>
          ))}
        </div>
      )}

      {needsPurchaseOrder && (
        <div className="mt-3 pt-3 border-t border-rule">
          <label
            tabIndex={0}
            onPaste={onPaste}
            onMouseEnter={onPasteHoverIn}
            onMouseLeave={onPasteHoverOut}
            className="flex items-center justify-center gap-2 border-[1.5px] border-dashed border-gold/50 rounded-md py-2.5 cursor-pointer text-[12px] focus:outline-none focus:border-gold"
            style={{ color: "#D9A441" }}
          >
            {uploading ? <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Upload size={14} />}
            Falta subir la orden de compra — subir o pegar (pasa el mouse y Ctrl+V)
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </label>
          <label className="flex items-center justify-center gap-1.5 mt-1.5 text-[10.5px] text-steel cursor-pointer hover:text-teal">
            <FileText size={10.5} /> ¿Es un PDF? Subir documento
            <input type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </label>
          {err && <div className="text-red text-[11.5px] mt-1.5">{err}</div>}
        </div>
      )}
    </div>
  );
}

export function MyPurchaseRequests() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    fetch("/api/purchase-requests?view=mine").then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => setRows([]));
  }, []);

  if (!rows) return <div className="text-steel text-[13px]">Cargando…</div>;
  if (rows.length === 0) return <div className="border-[1.5px] border-dashed border-rule rounded-md p-8 text-center text-steel text-[13.5px]">Todavía no has enviado ninguna solicitud.</div>;

  const groups = groupRows(rows);
  const pendingPOCount = groups.filter((g) => g[0].status !== "REJECTED" && !g[0].purchaseOrderUrl).length;

  function markUploaded(groupId: string, url: string) {
    setRows((rs) => rs && rs.map((r) => (r.groupId === groupId ? { ...r, purchaseOrderUrl: url } : r)));
  }

  return (
    <div>
      {pendingPOCount > 0 && (
        <div className="flex items-center gap-2 bg-gold/10 border border-gold/35 rounded-md px-3.5 py-2.5 mb-3.5 text-[12.5px]" style={{ color: "#D9A441" }}>
          <FileText size={15} />
          Te {pendingPOCount === 1 ? "falta subir la orden de compra de 1 solicitud" : `faltan subir las órdenes de compra de ${pendingPOCount} solicitudes`} — señaladas abajo.
        </div>
      )}
      <div className="flex flex-col gap-2.5">
        {groups.map((g) => (
          <GroupCard key={g[0].groupId} g={g} onPurchaseOrderUploaded={markUploaded} />
        ))}
      </div>
    </div>
  );
}
