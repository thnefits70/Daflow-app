"use client";

import { useEffect, useState } from "react";
import { Upload, FileText, Download, Trash2, ChevronLeft, ChevronRight } from "lucide-react";

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function fileKind(name: string): "pdf" | "image" | "other" {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return "pdf";
  if (/\.(png|jpe?g|gif|webp)$/.test(n)) return "image";
  return "other";
}

async function uploadFile(file: File): Promise<{ url: string; name: string } | null> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("folder", "pay-stubs");
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  if (!res.ok) return null;
  return res.json();
}

type Dept = { id: string; name: string; code: string };
type StubDTO = { id: string; fileUrl: string; fileName: string; updatedAt: string };
type RosterEntry = { user: { id: string; name: string; position: string | null }; stub: StubDTO | null };
type OwnStub = StubDTO & { month: number; year: number };

function StubPreview({ url, name }: { url: string; name: string }) {
  const kind = fileKind(name);
  if (kind === "pdf") {
    return <iframe src={url} title={name} className="w-full border border-rule rounded mt-2.5" style={{ height: 480 }} />;
  }
  if (kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name} className="w-full rounded mt-2.5 border border-rule" />;
  }
  return null;
}

function RosterRow({
  entry,
  onUpload,
  onDelete,
  busy,
}: {
  entry: RosterEntry;
  onUpload: (userId: string, file: File) => void;
  onDelete: (id: string) => void;
  busy: boolean;
}) {
  const [viewing, setViewing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { user, stub } = entry;

  return (
    <div className="bg-surface border border-rule rounded p-3.5 mb-2.5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="font-semibold text-[13.5px]">{user.name}</div>
          {user.position && <div className="text-[11.5px] text-steel">{user.position}</div>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {stub ? (
            <>
              <span className="font-mono text-[10.5px] text-steel">
                Subido {new Date(stub.updatedAt).toLocaleDateString("es-MX")}
              </span>
              {fileKind(stub.fileName) !== "other" && (
                <button
                  type="button"
                  className="text-[12px] font-semibold border border-rule rounded px-2.5 py-1.5 cursor-pointer"
                  onClick={() => setViewing((v) => !v)}
                >
                  {viewing ? "Ocultar" : "Ver"}
                </button>
              )}
              <a href={stub.fileUrl} download={stub.fileName} className="text-steel hover:text-ink">
                <Download size={14} />
              </a>
              <label className="inline-flex items-center gap-1.5 text-[12px] font-semibold border border-blue text-blue rounded px-2.5 py-1.5 cursor-pointer">
                <Upload size={12} /> Reemplazar
                <input
                  type="file"
                  accept=".pdf,image/*"
                  className="hidden"
                  disabled={busy}
                  onChange={(e) => e.target.files?.[0] && onUpload(user.id, e.target.files[0])}
                />
              </label>
              {confirmingDelete ? (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className="text-[11.5px] font-semibold text-red cursor-pointer"
                    onClick={() => onDelete(stub.id)}
                  >
                    Sí, eliminar
                  </button>
                  <button
                    type="button"
                    className="text-[11.5px] text-steel cursor-pointer"
                    onClick={() => setConfirmingDelete(false)}
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => setConfirmingDelete(true)}>
                  <Trash2 size={14} />
                </button>
              )}
            </>
          ) : (
            <label className="inline-flex items-center gap-1.5 text-[12px] font-semibold border border-blue bg-blue text-white rounded px-2.5 py-1.5 cursor-pointer">
              <Upload size={12} /> {busy ? "Subiendo…" : "Subir"}
              <input
                type="file"
                accept=".pdf,image/*"
                className="hidden"
                disabled={busy}
                onChange={(e) => e.target.files?.[0] && onUpload(user.id, e.target.files[0])}
              />
            </label>
          )}
        </div>
      </div>
      {viewing && stub && <StubPreview url={stub.fileUrl} name={stub.fileName} />}
    </div>
  );
}

export function PayStubsPanel({ mode, departments }: { mode: "manage" | "own"; departments?: Dept[] }) {
  const now = new Date();
  const yearOptions = Array.from({ length: 7 }, (_, i) => now.getFullYear() + 1 - i);
  const [deptId, setDeptId] = useState(departments?.[0]?.id ?? "");
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [ownStubs, setOwnStubs] = useState<OwnStub[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [viewingOwnId, setViewingOwnId] = useState<string | null>(null);
  const [filterMonth, setFilterMonth] = useState(0); // 0 = todos
  const [filterYear, setFilterYear] = useState(0); // 0 = todos

  useEffect(() => {
    fetch("/api/me/seen-pay-stubs", { method: "POST" });
  }, []);

  const loadRoster = async () => {
    if (!deptId) return;
    setLoading(true);
    setErr("");
    const res = await fetch(`/api/pay-stubs?deptId=${deptId}&month=${month}&year=${year}`);
    setLoading(false);
    if (!res.ok) {
      setErr("No se pudo cargar la lista.");
      return;
    }
    const data = await res.json();
    setRoster(data.roster);
  };

  const loadOwn = async () => {
    setLoading(true);
    const res = await fetch("/api/pay-stubs");
    setLoading(false);
    if (!res.ok) return;
    const data = await res.json();
    setOwnStubs(data.stubs);
  };

  useEffect(() => {
    if (mode === "manage") loadRoster();
    else loadOwn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, deptId, month, year]);

  const handleUpload = async (userId: string, file: File) => {
    setUploadingFor(userId);
    setErr("");
    const uploaded = await uploadFile(file);
    if (!uploaded) {
      setErr("No se pudo subir el archivo.");
      setUploadingFor(null);
      return;
    }
    const res = await fetch("/api/pay-stubs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, month, year, fileUrl: uploaded.url, fileName: uploaded.name }),
    });
    setUploadingFor(null);
    if (!res.ok) {
      setErr("No se pudo guardar el comprobante.");
      return;
    }
    loadRoster();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/pay-stubs/${id}`, { method: "DELETE" });
    loadRoster();
  };

  const shiftMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setMonth(m);
    setYear(y);
  };

  if (mode === "own") {
    const ownYears = Array.from(new Set((ownStubs ?? []).map((s) => s.year))).sort((a, b) => b - a);
    const filteredStubs = (ownStubs ?? []).filter(
      (s) => (filterMonth === 0 || s.month === filterMonth) && (filterYear === 0 || s.year === filterYear)
    );

    return (
      <div>
        {(ownStubs?.length ?? 0) > 0 && (
          <div className="flex items-center gap-3 flex-wrap mb-4.5">
            <select
              className="rounded border border-rule bg-surface px-2.5 py-2 text-[13px]"
              value={filterMonth}
              onChange={(e) => setFilterMonth(Number(e.target.value))}
            >
              <option value={0}>Todos los meses</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
            <select
              className="rounded border border-rule bg-surface px-2.5 py-2 text-[13px]"
              value={filterYear}
              onChange={(e) => setFilterYear(Number(e.target.value))}
            >
              <option value={0}>Todos los años</option>
              {ownYears.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        )}

        {(ownStubs?.length ?? 0) === 0 && !loading && (
          <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
            Aún no se ha subido tu rol de pago.
          </div>
        )}
        {(ownStubs?.length ?? 0) > 0 && filteredStubs.length === 0 && (
          <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
            No hay comprobantes para ese filtro.
          </div>
        )}
        {filteredStubs.map((s) => (
          <div key={s.id} className="bg-surface border border-rule rounded p-3.5 mb-2.5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 font-semibold text-[13.5px]">
                <FileText size={14} className="text-steel" /> {MONTHS[s.month - 1]} {s.year}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {fileKind(s.fileName) !== "other" && (
                  <button
                    type="button"
                    className="text-[12px] font-semibold border border-rule rounded px-2.5 py-1.5 cursor-pointer"
                    onClick={() => setViewingOwnId(viewingOwnId === s.id ? null : s.id)}
                  >
                    {viewingOwnId === s.id ? "Ocultar" : "Ver"}
                  </button>
                )}
                <a href={s.fileUrl} download={s.fileName} className="text-steel hover:text-ink">
                  <Download size={14} />
                </a>
              </div>
            </div>
            {viewingOwnId === s.id && <StubPreview url={s.fileUrl} name={s.fileName} />}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap mb-4.5">
        <select
          className="rounded border border-rule bg-surface px-2.5 py-2 text-[13px]"
          value={deptId}
          onChange={(e) => setDeptId(e.target.value)}
        >
          {departments?.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <div className="flex items-center gap-1.5">
          <button type="button" className="p-1.5 border border-rule rounded cursor-pointer" onClick={() => shiftMonth(-1)}>
            <ChevronLeft size={14} />
          </button>
          <select
            className="rounded border border-rule bg-surface px-2.5 py-2 text-[13px]"
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
          <select
            className="rounded border border-rule bg-surface px-2.5 py-2 text-[13px]"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button type="button" className="p-1.5 border border-rule rounded cursor-pointer" onClick={() => shiftMonth(1)}>
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {err && <div className="text-red text-[12.5px] mb-3">{err}</div>}

      {loading && <div className="text-steel text-[13px]">Cargando…</div>}

      {!loading && (roster?.length ?? 0) === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          No hay nadie en esta área.
        </div>
      )}

      {!loading &&
        roster?.map((entry) => (
          <RosterRow
            key={entry.user.id}
            entry={entry}
            onUpload={handleUpload}
            onDelete={handleDelete}
            busy={uploadingFor === entry.user.id}
          />
        ))}
    </div>
  );
}
