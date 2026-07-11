"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Upload, X, Download, Plus, Trash2, KeyRound,
  User, Building2, Briefcase, Mail, Phone, Calendar, Award, FileText,
} from "lucide-react";
import { PositionPicker } from "@/components/users/PositionPicker";

type Dept = { id: string; name: string; code: string };
type Position = { id: string; deptId: string; name: string };
type Milestone = { id: string; title: string; note: string | null; date: string };
type ExamScore = { id: string; score: number; total: number; createdAt: string; exam: { title: string } };

type UserProfile = {
  id: string;
  name: string;
  username: string;
  deptId: string | null;
  position: string | null;
  photoUrl: string | null;
  email: string | null;
  phone: string | null;
  startDate: string | null;
  skills: string[];
  cvUrl: string | null;
  cvName: string | null;
  isLeader: boolean;
  leadsDeptId: string | null;
  canManageLaws: boolean;
  milestones: Milestone[];
  examScores: ExamScore[];
};

function pct(a: number, b: number) {
  return b === 0 ? 0 : Math.round((a / b) * 100);
}

function cvKind(cvUrl: string | null, cvName: string | null): "pdf" | "image" | "other" {
  const name = (cvName || cvUrl || "").toLowerCase();
  if (name.endsWith(".pdf")) return "pdf";
  if (/\.(png|jpe?g|gif|webp)$/.test(name)) return "image";
  return "other";
}

async function uploadFile(file: File, folder: string): Promise<{ url: string; name: string } | null> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("folder", folder);
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  if (!res.ok) return null;
  return res.json();
}

export function ProfileDetail({
  profile,
  departments,
  positions,
}: {
  profile: UserProfile;
  departments: Dept[];
  positions: Position[];
}) {
  const router = useRouter();
  const [p, setP] = useState(profile);
  const [busy, setBusy] = useState(false);
  const [photoErr, setPhotoErr] = useState("");
  const [cvErr, setCvErr] = useState("");
  const [skillInput, setSkillInput] = useState("");
  const [resetting, setResetting] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [mTitle, setMTitle] = useState("");
  const [mNote, setMNote] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [showCv, setShowCv] = useState(false);

  const removePosition = async (id: string) => {
    setBusy(true);
    await fetch(`/api/positions/${id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  };

  const removeUser = async () => {
    setDeleting(true);
    await fetch(`/api/users/${p.id}`, { method: "DELETE" });
    router.push("/admin/nomina");
    router.refresh();
  };

  const save = async (patch: Partial<UserProfile>) => {
    const next = { ...p, ...patch };
    setP(next);
    setBusy(true);
    await fetch(`/api/users/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setBusy(false);
    router.refresh();
  };

  const handlePhoto = async (file: File) => {
    setPhotoErr("");
    const result = await uploadFile(file, "photos");
    if (!result) { setPhotoErr("No se pudo subir la foto."); return; }
    save({ photoUrl: result.url });
  };

  const handleCv = async (file: File) => {
    setCvErr("");
    const result = await uploadFile(file, "cvs");
    if (!result) { setCvErr("No se pudo subir el CV."); return; }
    save({ cvUrl: result.url, cvName: result.name });
  };

  const addSkill = () => {
    const v = skillInput.trim();
    if (!v || p.skills.includes(v)) { setSkillInput(""); return; }
    save({ skills: [...p.skills, v] });
    setSkillInput("");
  };
  const removeSkill = (s: string) => save({ skills: p.skills.filter((x) => x !== s) });

  const savePassword = async () => {
    if (!newPassword.trim()) return;
    setBusy(true);
    await fetch(`/api/users/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: newPassword.trim() }),
    });
    setBusy(false);
    setResetting(false);
    setNewPassword("");
  };

  const addMilestone = async () => {
    if (!mTitle.trim()) return;
    setBusy(true);
    const res = await fetch(`/api/users/${p.id}/milestones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: mTitle.trim(), note: mNote.trim() }),
    });
    setBusy(false);
    if (!res.ok) return;
    const created = await res.json();
    setP({ ...p, milestones: [created, ...p.milestones] });
    setMTitle("");
    setMNote("");
  };

  const removeMilestone = async (id: string) => {
    setP({ ...p, milestones: p.milestones.filter((m) => m.id !== id) });
    await fetch(`/api/milestones/${id}`, { method: "DELETE" });
  };

  const deptPositions = positions.filter((pos) => pos.deptId === p.deptId);

  const timeline = [
    ...p.milestones.map((m) => ({ id: m.id, kind: "hito" as const, title: m.title, note: m.note, date: m.date })),
    ...p.examScores.map((e) => ({
      id: e.id,
      kind: "examen" as const,
      title: `Examen: ${e.exam.title}`,
      note: `${e.score}/${e.total} · ${pct(e.score, e.total)}%`,
      date: e.createdAt,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div>
      <div className="flex items-center justify-between mb-4.5">
        <Link href="/admin/nomina" className="inline-flex items-center gap-1.5 text-[13px] text-steel hover:text-ink">
          <ArrowLeft size={14} /> Volver a nómina
        </Link>
        {confirmingDelete ? (
          <div className="flex items-center gap-2.5">
            <span className="text-[12.5px] text-steel">¿Eliminar a {p.name}? Se borra su acceso, ficha e historial.</span>
            <button
              type="button"
              disabled={deleting}
              className="rounded border border-red bg-red px-3 py-1.5 text-[12px] font-semibold text-white cursor-pointer disabled:opacity-60"
              onClick={removeUser}
            >
              {deleting ? "Eliminando…" : "Sí, eliminar"}
            </button>
            <button
              type="button"
              className="text-[12px] text-steel cursor-pointer"
              onClick={() => setConfirmingDelete(false)}
            >
              Cancelar
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-red hover:opacity-80 cursor-pointer"
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 size={14} /> Eliminar usuario
          </button>
        )}
      </div>

      <div className="bg-surface border border-rule rounded p-5 flex gap-6 flex-wrap items-start">
        <div className="text-center">
          <div className="w-24 h-24 rounded-full overflow-hidden bg-cloud border border-rule flex items-center justify-center mb-2">
            {p.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.photoUrl} alt={p.name} className="w-full h-full object-cover" />
            ) : (
              <User size={30} className="text-steel" />
            )}
          </div>
          <label className="inline-flex items-center gap-1 text-[11px] font-semibold border border-rule rounded px-2.5 py-1.5 cursor-pointer">
            <Upload size={11} /> Foto
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handlePhoto(e.target.files[0])} />
          </label>
          {photoErr && <div className="text-red text-[11px] mt-1">{photoErr}</div>}
        </div>

        <div className="flex-1 min-w-[260px]">
          <input
            className="font-display text-[20px] font-bold border-none bg-transparent outline-none focus:ring-0 px-0 w-full mb-1.5"
            value={p.name}
            onChange={(e) => setP({ ...p, name: e.target.value })}
            onBlur={(e) => save({ name: e.target.value })}
          />
          <div className="flex items-center gap-1.5 text-[12.5px] text-steel mb-3.5">
            <span>usuario</span>
            <input
              className="font-mono border border-rule rounded px-1.5 py-0.5 text-[12px] w-auto"
              style={{ width: `${Math.max(p.username.length, 6) + 2}ch` }}
              value={p.username}
              onChange={(e) => setP({ ...p, username: e.target.value })}
              onBlur={(e) => save({ username: e.target.value.trim().toLowerCase() })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="flex items-center gap-1 mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                <Building2 size={11} /> Área
              </label>
              <select
                className="w-full rounded border border-rule px-2.5 py-2 text-[13px] bg-surface"
                value={p.deptId ?? ""}
                onChange={(e) => save({ deptId: e.target.value, position: null })}
              >
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="flex items-center gap-1 mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                <Briefcase size={11} /> Cargo
              </label>
              {p.deptId && (
                <PositionPicker
                  deptId={p.deptId}
                  positions={deptPositions}
                  value={p.position ?? ""}
                  onChange={(v) => save({ position: v })}
                  onPositionCreated={() => router.refresh()}
                />
              )}
              <button
                type="button"
                className="mt-1 text-[11px] text-steel hover:text-ink cursor-pointer underline underline-offset-2"
                onClick={() => setShowCatalog((v) => !v)}
              >
                {showCatalog ? "Ocultar" : "Administrar"} catálogo de puestos ({deptPositions.length})
              </button>
              {showCatalog && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {deptPositions.length === 0 && (
                    <span className="text-[11.5px] text-steel">Aún no hay puestos para esta área.</span>
                  )}
                  {deptPositions.map((pos) => (
                    <span
                      key={pos.id}
                      className="inline-flex items-center gap-1 text-[11.5px] bg-cloud border border-rule rounded-full px-2.5 py-1"
                    >
                      {pos.name}
                      <button
                        type="button"
                        disabled={busy}
                        className="text-steel hover:text-red cursor-pointer"
                        onClick={() => removePosition(pos.id)}
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="flex items-center gap-1 mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                <Calendar size={11} /> Fecha de ingreso
              </label>
              <input
                type="date"
                className="w-full rounded border border-rule px-2.5 py-2 text-[13px]"
                value={p.startDate ? p.startDate.slice(0, 10) : ""}
                onChange={(e) => save({ startDate: e.target.value || null })}
              />
            </div>
            <div>
              <label className="flex items-center gap-1 mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                <Mail size={11} /> Correo
              </label>
              <input
                className="w-full rounded border border-rule px-2.5 py-2 text-[13px]"
                placeholder="correo@empresa.com"
                value={p.email ?? ""}
                onChange={(e) => setP({ ...p, email: e.target.value })}
                onBlur={(e) => save({ email: e.target.value })}
              />
            </div>
            <div>
              <label className="flex items-center gap-1 mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                <Phone size={11} /> Teléfono
              </label>
              <input
                className="w-full rounded border border-rule px-2.5 py-2 text-[13px]"
                placeholder="09xxxxxxxx"
                value={p.phone ?? ""}
                onChange={(e) => setP({ ...p, phone: e.target.value })}
                onBlur={(e) => save({ phone: e.target.value })}
              />
            </div>
            <div>
              <label className="flex items-center gap-1 mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                <KeyRound size={11} /> Contraseña
              </label>
              {resetting ? (
                <div className="flex items-center gap-1.5">
                  <input
                    className="flex-1 rounded border border-rule px-2.5 py-2 text-[13px]"
                    placeholder="Nueva contraseña"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                  <button type="button" disabled={busy} className="rounded border border-blue bg-blue px-3 py-2 text-[12px] font-semibold text-white cursor-pointer" onClick={savePassword}>
                    Guardar
                  </button>
                </div>
              ) : (
                <button type="button" className="text-[12.5px] text-steel hover:text-ink cursor-pointer underline underline-offset-2" onClick={() => setResetting(true)}>
                  Restablecer contraseña
                </button>
              )}
            </div>
          </div>

          <div className="bg-cloud border border-rule rounded p-3.5 mt-3.5">
            <label className="flex items-center gap-1 mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
              <Award size={11} /> ¿Lidera un equipo?
            </label>
            <div className="flex border border-rule rounded overflow-hidden max-w-[220px] mb-2.5">
              <button
                type="button"
                className={`flex-1 py-1.5 text-[12.5px] font-semibold cursor-pointer ${p.isLeader ? "bg-blue text-white" : "bg-surface text-steel"}`}
                onClick={() => save({ isLeader: true })}
              >
                Sí
              </button>
              <button
                type="button"
                className={`flex-1 py-1.5 text-[12.5px] font-semibold cursor-pointer ${!p.isLeader ? "bg-blue text-white" : "bg-surface text-steel"}`}
                onClick={() => save({ isLeader: false, leadsDeptId: null })}
              >
                No
              </button>
            </div>
            {p.isLeader && (
              <select
                className="w-full rounded border border-rule px-2.5 py-2 text-[13px] bg-surface"
                value={p.leadsDeptId ?? ""}
                onChange={(e) => save({ leadsDeptId: e.target.value || null })}
              >
                <option value="">Selecciona un área…</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            )}
          </div>

          <div className="bg-cloud border border-rule rounded p-3.5 mt-3.5">
            <label className="flex items-center gap-1 mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
              <FileText size={11} /> ¿Puede subir Leyes y Reglamentos?
            </label>
            <div className="text-[11px] text-steel mb-2">
              Puede crear y editar documentos visibles para toda la empresa, pero no eliminarlos — eso solo lo
              puedes hacer tú.
            </div>
            <div className="flex border border-rule rounded overflow-hidden max-w-[220px]">
              <button
                type="button"
                className={`flex-1 py-1.5 text-[12.5px] font-semibold cursor-pointer ${p.canManageLaws ? "bg-blue text-white" : "bg-surface text-steel"}`}
                onClick={() => save({ canManageLaws: true })}
              >
                Sí
              </button>
              <button
                type="button"
                className={`flex-1 py-1.5 text-[12.5px] font-semibold cursor-pointer ${!p.canManageLaws ? "bg-blue text-white" : "bg-surface text-steel"}`}
                onClick={() => save({ canManageLaws: false })}
              >
                No
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-4 items-start">
        <div>
          <h3 className="text-[14px] font-semibold mb-2.5">Habilidades y conocimientos</h3>
          <div className="bg-surface border border-rule rounded p-3.5">
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {p.skills.map((s) => (
                <span key={s} className="inline-flex items-center gap-1 text-[12px] bg-cloud border border-rule rounded-full px-2.5 py-1">
                  {s}
                  <X size={11} className="cursor-pointer" onClick={() => removeSkill(s)} />
                </span>
              ))}
              {p.skills.length === 0 && <span className="text-[12px] text-steel">Aún no hay habilidades.</span>}
            </div>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[13px]"
                placeholder="Ej. Excel avanzado…"
                value={skillInput}
                onChange={(e) => setSkillInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addSkill()}
              />
              <button type="button" className="rounded border border-rule px-3 py-1.5 text-[12px] font-semibold cursor-pointer" onClick={addSkill}>
                <Plus size={12} className="inline -mt-0.5" /> Añadir
              </button>
            </div>
          </div>

          <h3 className="text-[14px] font-semibold mt-4.5 mb-2.5">Currículum (CV)</h3>
          <div className="bg-surface border border-rule rounded p-3.5">
            {p.cvUrl ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] flex items-center gap-1.5"><FileText size={14} /> {p.cvName || "CV cargado"}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {cvKind(p.cvUrl, p.cvName) !== "other" && (
                      <button
                        type="button"
                        className="text-[12px] font-semibold border border-rule rounded px-2.5 py-1.5 cursor-pointer"
                        onClick={() => setShowCv((v) => !v)}
                      >
                        {showCv ? "Ocultar" : "Ver CV"}
                      </button>
                    )}
                    <a href={p.cvUrl} download={p.cvName || "CV.pdf"} className="text-steel hover:text-ink"><Download size={14} /></a>
                    <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => { save({ cvUrl: null, cvName: null }); setShowCv(false); }}><Trash2 size={14} /></button>
                  </div>
                </div>
                {showCv && cvKind(p.cvUrl, p.cvName) === "pdf" && (
                  <iframe src={p.cvUrl} title={p.cvName || "CV"} className="w-full border border-rule rounded mt-3" style={{ height: 520 }} />
                )}
                {showCv && cvKind(p.cvUrl, p.cvName) === "image" && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.cvUrl} alt={p.cvName || "CV"} className="w-full rounded mt-3 border border-rule" />
                )}
              </>
            ) : (
              <label className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold border border-blue bg-blue text-white rounded px-3 py-2 cursor-pointer">
                <Upload size={13} /> Subir CV
                <input type="file" accept=".pdf,.doc,.docx,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleCv(e.target.files[0])} />
              </label>
            )}
            {cvErr && <div className="text-red text-[11.5px] mt-1.5">{cvErr}</div>}
          </div>
        </div>

        <div>
          <h3 className="text-[14px] font-semibold mb-2.5">Añadir hito de carrera</h3>
          <div className="bg-surface border border-rule rounded p-3.5">
            <input
              className="w-full rounded border border-rule px-2.5 py-2 text-[13px] mb-2"
              placeholder="Ej. Completó capacitación de Excel avanzado"
              value={mTitle}
              onChange={(e) => setMTitle(e.target.value)}
            />
            <input
              className="w-full rounded border border-rule px-2.5 py-2 text-[13px] mb-2.5"
              placeholder="Nota (opcional)"
              value={mNote}
              onChange={(e) => setMNote(e.target.value)}
            />
            <button type="button" disabled={busy} className="rounded border border-rule px-3 py-1.5 text-[12.5px] font-semibold cursor-pointer" onClick={addMilestone}>
              <Plus size={12} className="inline -mt-0.5" /> Registrar hito
            </button>
          </div>

          <h3 className="text-[14px] font-semibold mt-4.5 mb-2.5">Historial / Ficha técnica</h3>
          {timeline.length === 0 && (
            <div className="border-[1.5px] border-dashed border-rule rounded-md p-6 text-center text-steel text-[12.5px]">
              Aún no hay historial registrado.
            </div>
          )}
          {timeline.map((t) => (
            <div key={t.kind + t.id} className="bg-surface border border-rule rounded p-3 mb-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[13px]">{t.kind === "examen" ? "🎓 " : "★ "}{t.title}</span>
                {t.kind === "hito" && (
                  <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => removeMilestone(t.id)}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              {t.note && <div className="text-[12px] text-steel mt-0.5">{t.note}</div>}
              <div className="font-mono text-[10.5px] text-steel mt-1">{new Date(t.date).toLocaleDateString()}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
