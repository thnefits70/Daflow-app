import sharp from "sharp";
import { revalidateTag, unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase";
import { getAnthropicClient } from "@/lib/nancy";
import { logAiUsage } from "@/lib/aiUsage";
import { publicPhotoUrl } from "@/lib/provedixPublic";
import { TEAM_PHOTOS, TEAM_PHOTOS_REJECTED, type TeamPhoto } from "@/lib/pvxTeamPhotos";

// Fotos del equipo desde Drive, SOLAS (pedido del usuario 2026-10-16: "que no
// dependa de mí"). Los días 1 y 15 (vercel.json) el servidor lista la
// carpeta pública de Drive, baja las fotos nuevas y UNA sola consulta de IA
// las revisa todas juntas: descarta las que muestran datos de clientes,
// proveedores o la ubicación, las borrosas y las repetidas, y aprueba solo
// las mejores. Las aprobadas se guardan en Supabase (carpeta provedix-team,
// sin datos de la cámara) y entran a la rotación semanal de la página. El
// admin puede quitar cualquiera desde la sección Provedix.

export const DRIVE_FOLDER_ID = "1cYyiLK6aQF_mRENmWkqRsk1v-akCbY_R";
export const TEAM_PHOTOS_TAG = "provedix-team-photos";
const BUCKET = "daflow-files";
const FOLDER = "provedix-team";
const MAX_POOL = 14;
const MIN_PORTRAITS = 2;
const MIN_WORK = 4;
const MIN_SCORE = 7;
const MAX_NEW_PER_RUN = 12;
const MAX_BYTES = 20 * 1024 * 1024;
const AI_MODEL = "claude-opus-5-5";
const STATIC_SCORE = 7;

type DbPhoto = { driveId: string; status: string; kind: string | null; url: string | null; title: string | null; alt: string | null; score: number | null; createdAt: Date };

// ---- Lo que ve la página -------------------------------------------------------

type PoolPhoto = TeamPhoto & { score: number; fromDb: boolean; createdAt: number };

async function loadPool(): Promise<PoolPhoto[]> {
  const rows: DbPhoto[] = await prisma.provedixTeamPhoto.findMany({
    where: { status: { in: ["approved", "retired"] } },
    select: { driveId: true, status: true, kind: true, url: true, title: true, alt: true, score: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const retired = new Set(rows.filter((r) => r.status === "retired").map((r) => r.driveId));
  const fromCode: PoolPhoto[] = TEAM_PHOTOS.filter((p) => !retired.has(p.driveId)).map((p) => ({ ...p, score: STATIC_SCORE, fromDb: false, createdAt: 0 }));
  const fromDb: PoolPhoto[] = rows
    .filter((r) => r.status === "approved" && r.url && (r.kind === "portrait" || r.kind === "work"))
    .map((r) => ({
      kind: r.kind as "portrait" | "work",
      driveId: r.driveId,
      src: publicPhotoUrl(r.url) ?? r.url!,
      title: r.title ?? "Nuestro equipo",
      alt: r.alt ?? "Colaborador de Provedix en la bodega",
      score: r.score ?? STATIC_SCORE,
      fromDb: true,
      createdAt: r.createdAt.getTime(),
    }));
  return [...fromCode, ...fromDb];
}

// Grupo de fotos activas para la página (se refresca al cambiar algo).
export const getTeamPhotoPool = unstable_cache(
  async (): Promise<TeamPhoto[]> => (await loadPool()).map(({ kind, driveId, src, title, alt }) => ({ kind, driveId, src, title, alt })),
  ["provedix-team-photo-pool"],
  { tags: [TEAM_PHOTOS_TAG], revalidate: 3600 },
);

// ---- Drive ---------------------------------------------------------------------

export async function listDriveFolder(): Promise<{ id: string; name: string }[]> {
  const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${DRIVE_FOLDER_ID}`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Drive respondió ${res.status}`);
  const html = await res.text();
  const out: { id: string; name: string }[] = [];
  const re = /id="entry-([\w-]{10,})"[\s\S]*?flip-entry-title">([^<]*)</g;
  for (let m = re.exec(html); m; m = re.exec(html)) out.push({ id: m[1], name: m[2].trim() });
  return out;
}

async function downloadDriveImage(id: string): Promise<Buffer | null> {
  const res = await fetch(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`, { cache: "no-store", signal: AbortSignal.timeout(60_000) }).catch(() => null);
  if (!res?.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > 0 && buf.length <= MAX_BYTES ? buf : null;
}

// ---- IA ------------------------------------------------------------------------

const SYSTEM = `Eres el editor de fotos de provedix.com, la página pública de Provedix (proveedor de productos para dropshippers en Guayaquil, Ecuador). Revisas fotos que el equipo subió de su trabajo en la bodega y decides cuáles se publican en la sección "Un equipo que sí existe".

RECHAZA (usable: false) cualquier foto que muestre algo de esto, aunque sea pequeño o en el fondo, si se puede leer:
- guías o etiquetas de envío con datos de clientes (nombre, teléfono, dirección, cédula, nombre de tienda)
- etiquetas, nombres o marcas de proveedores, o cajas/sacos con "MADE IN CHINA" legible
- la ubicación exacta: dirección, letreros de calle, fachada del local, placas de autos
- pantallas con información, documentos, facturas, dinero
- personas que no parecen del equipo, niños, gestos o poses inapropiadas
- productos o cajas en mal estado: aplastadas, rotas, abolladas, sucias, mojadas o desordenadas (la bodega debe verse cuidada y ordenada)
- fotos borrosas, oscuras, torcidas, mal encuadradas o con la persona cortada
- fotos casi iguales a otra de las nuevas o a una de la página actual (misma persona, misma pose y mismo lugar)
Si dudas, recházala. Los códigos QR de las perchas sí se permiten.

APRUEBA solo las mejores: nítidas, con buena luz, que muestren personas del equipo (idealmente con la camiseta Provedix) trabajando (ordenando, revisando, preparando o empacando pedidos) o retratos amables. Califica la calidad de 1 a 10 (7 o más = publicable).

Para cada foto nueva responde con:
- i: el número de la foto nueva
- usable: true o false
- reason: si la rechazas, el motivo en pocas palabras en español; si la apruebas, por qué es buena
- kind: "portrait" (posa mirando a la cámara) o "work" (está trabajando)
- quality: 1 a 10
- title: título corto y positivo para dropshippers, máximo 45 caracteres (por ejemplo "Revisamos antes de empacar")
- alt: descripción de la foto en español, sin nombres de personas (por ejemplo "Colaborador de Provedix empacando un pedido")

Responde SOLO con un arreglo JSON, sin texto antes ni después.`;

type Verdict = { i: number; usable: boolean; reason: string; kind: "portrait" | "work"; quality: number; title: string; alt: string };

function parseVerdicts(text: string): Verdict[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as unknown[];
    return raw
      .filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
      .map((v) => ({
        i: Number(v.i),
        usable: v.usable === true,
        reason: String(v.reason ?? "").slice(0, 200),
        kind: v.kind === "portrait" ? ("portrait" as const) : ("work" as const),
        quality: Math.max(1, Math.min(10, Math.round(Number(v.quality) || 0))),
        title: String(v.title ?? "").trim().slice(0, 60),
        alt: String(v.alt ?? "").trim().slice(0, 200),
      }))
      .filter((v) => Number.isInteger(v.i));
  } catch {
    return [];
  }
}

async function jpegForAi(input: Buffer, size: number): Promise<string> {
  const out = await sharp(input).rotate().resize(size, size, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
  return out.toString("base64");
}

async function poolThumbs(pool: PoolPhoto[]): Promise<string[]> {
  const base = "https://provedix.com";
  return Promise.all(
    pool.map(async (p) => {
      try {
        const res = await fetch(p.src.startsWith("http") ? p.src : `${base}${p.src}`, { signal: AbortSignal.timeout(20_000) });
        return res.ok ? await jpegForAi(Buffer.from(await res.arrayBuffer()), 256) : "";
      } catch {
        return "";
      }
    }),
  );
}

// ---- Revisión ------------------------------------------------------------------

export type SyncResult = { found: number; reviewed: number; approved: string[]; rejected: string[]; retired: string[]; error?: string };

export async function syncTeamPhotosFromDrive(): Promise<SyncResult> {
  const result: SyncResult = { found: 0, reviewed: 0, approved: [], rejected: [], retired: [] };
  const files = await listDriveFolder();
  result.found = files.length;
  const known = new Set<string>([...TEAM_PHOTOS.map((p) => p.driveId), ...TEAM_PHOTOS_REJECTED.map((p) => p.driveId)]);
  for (const r of await prisma.provedixTeamPhoto.findMany({ select: { driveId: true } })) known.add(r.driveId);
  const fresh = files.filter((f) => !known.has(f.id)).slice(0, MAX_NEW_PER_RUN);
  if (!fresh.length) return result;

  // Bajar y preparar; lo que no se puede leer se anota como descartado.
  const ready: { id: string; original: Buffer; ai: string }[] = [];
  for (const f of fresh) {
    const buf = await downloadDriveImage(f.id);
    const ai = buf ? await jpegForAi(buf, 1024).catch(() => null) : null;
    if (!buf || !ai) {
      await prisma.provedixTeamPhoto.create({ data: { driveId: f.id, status: "rejected", reason: "No se pudo abrir (formato no compatible o archivo muy grande)" } });
      result.rejected.push(f.id);
      continue;
    }
    ready.push({ id: f.id, original: buf, ai });
  }
  if (!ready.length) return result;

  const pool = await loadPool();
  const thumbs = await poolThumbs(pool);
  type Block = { type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: "image/jpeg"; data: string } };
  const content: Block[] = [];
  content.push({ type: "text", text: `FOTOS QUE YA ESTÁN EN LA PÁGINA (${pool.length}), solo para comparar y no repetir:` });
  pool.forEach((p, k) => {
    if (!thumbs[k]) return;
    content.push({ type: "text", text: `Actual ${k + 1}: ${p.alt}` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: thumbs[k] } });
  });
  content.push({ type: "text", text: `FOTOS NUEVAS PARA REVISAR (${ready.length}):` });
  ready.forEach((r, i) => {
    content.push({ type: "text", text: `Nueva ${i}:` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: r.ai } });
  });

  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: "user", content }],
  });
  await logAiUsage({ feature: "provedix_fotos_equipo", model: AI_MODEL, actorId: "system", inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });
  const textBlock = response.content.find((b) => b.type === "text");
  const verdicts = parseVerdicts(textBlock && textBlock.type === "text" ? textBlock.text : "");
  // Sin respuesta clara de la IA no se publica nada (se reintenta en la próxima revisión).
  if (!verdicts.length) {
    result.error = "La IA no devolvió una respuesta clara; se reintenta en la próxima revisión.";
    return result;
  }
  result.reviewed = ready.length;

  const supabase = supabaseAdmin();
  for (let i = 0; i < ready.length; i++) {
    const r = ready[i];
    const v = verdicts.find((x) => x.i === i);
    if (!v) continue; // sin veredicto: queda para la próxima revisión
    const ok = v.usable && v.quality >= MIN_SCORE && v.title && v.alt;
    if (!ok) {
      await prisma.provedixTeamPhoto.create({ data: { driveId: r.id, status: "rejected", kind: v.kind, score: v.quality, reason: v.reason || "No es de las mejores" } });
      result.rejected.push(r.id);
      continue;
    }
    // 720×960 webp; sharp no copia los datos de la cámara (ni el GPS).
    const webp = await sharp(r.original).rotate().resize(720, 960, { fit: "cover", position: "top" }).webp({ quality: 72 }).toBuffer();
    const path = `${FOLDER}/${r.id}.webp`;
    const up = await supabase.storage.from(BUCKET).upload(path, webp, { contentType: "image/webp", upsert: true, cacheControl: "31536000" });
    if (up.error) {
      result.error = `No se pudo guardar una foto: ${up.error.message}`;
      continue;
    }
    const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    await prisma.provedixTeamPhoto.create({ data: { driveId: r.id, status: "approved", kind: v.kind, url, title: v.title, alt: v.alt, score: v.quality, reason: v.reason } });
    result.approved.push(r.id);
  }

  result.retired = await trimPool();
  revalidateTag(TEAM_PHOTOS_TAG, "max");
  return result;
}

// Sin saturar: si pasan de MAX_POOL, salen las de menor nota (y entre iguales,
// las más viejas), cuidando que queden al menos 2 retratos y 4 de trabajo.
async function trimPool(): Promise<string[]> {
  const pool = await loadPool();
  const retired: string[] = [];
  const active = [...pool];
  const ordered = [...pool].sort((a, b) => a.score - b.score || a.createdAt - b.createdAt);
  for (const p of ordered) {
    if (active.length <= MAX_POOL) break;
    const sameKind = active.filter((x) => x.kind === p.kind).length;
    if (sameKind <= (p.kind === "portrait" ? MIN_PORTRAITS : MIN_WORK)) continue;
    await retirePhoto(p.driveId, "Reemplazada por una mejor");
    active.splice(active.indexOf(p), 1);
    retired.push(p.driveId);
  }
  return retired;
}

export async function retirePhoto(driveId: string, reason: string): Promise<void> {
  await prisma.provedixTeamPhoto.upsert({
    where: { driveId },
    create: { driveId, status: "retired", reason },
    update: { status: "retired", reason },
  });
  revalidateTag(TEAM_PHOTOS_TAG, "max");
}

// Para la sección Provedix del admin.
export async function getTeamPhotosAdmin() {
  const [pool, recent] = await Promise.all([
    loadPool(),
    prisma.provedixTeamPhoto.findMany({
      where: { status: "rejected" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { driveId: true, reason: true, createdAt: true },
    }),
  ]);
  return {
    pool: pool.map((p) => ({ driveId: p.driveId, src: p.src, title: p.title, kind: p.kind, fromDrive: p.fromDb })),
    rejected: recent.map((r) => ({ driveId: r.driveId, reason: r.reason ?? "", at: r.createdAt.toISOString() })),
  };
}
