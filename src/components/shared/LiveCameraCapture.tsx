"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, RefreshCw, Upload, X } from "lucide-react";
import { compressImage } from "@/lib/compressImage";
import { uploadFile } from "@/lib/uploadFile";

type Props = {
  folder: string;
  // Confirmado 2026-08-26 (pedido explícito del usuario): el hash del
  // archivo (SHA-256, calculado del lado del cliente) va aparte de la url
  // para que quien consuma esto pueda detectar si subieron el MISMO
  // archivo dos veces sin querer (ej. Registro de Egresos marcando fotos
  // duplicadas) — no detecta "se ve parecido", solo "es el mismo archivo".
  onCaptured: (url: string, hash?: string) => void;
  onCancel?: () => void;
  // Confirmado 2026-08-26 (pedido explícito del usuario): SOLO para
  // fotografiar un documento físico (ej. la hoja de despacho en Registro
  // de Egresos) — ahí no hay nada que "probar" con una captura en vivo, es
  // simplemente leer un papel, y forzar la cámara del navegador no
  // funciona en desktop (webcam) ni cuando el documento ya llegó como
  // foto (ej. por WhatsApp). Sigue en false por defecto en todos los
  // demás usos (compras personales, recepción de mercadería, etc.) donde
  // la captura en vivo SÍ es una restricción a propósito.
  allowUpload?: boolean;
};

// Confirmado 2026-08-18: pedido explícito del usuario — sin estas
// restricciones, en celulares con varias cámaras traseras el navegador a
// veces elige sola la lente ultra gran angular (efecto "ojo de pez",
// bordes/esquinas curvos). Pedir un ancho/alto ideal es lo que hace que
// elija la lente principal en vez de esa.
const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 960 } },
  audio: false,
};

// Confirmado 2026-08-18: pedido explícito del usuario — la foto de una
// compra personal tiene que ser tomada EN VIVO, nunca elegida de la
// galería. Ningún sistema web puede garantizarlo al 100% (alguien podría
// fotografiar una foto), pero esto es lo más cercano: la cámara se abre
// DENTRO de esta pantalla con getUserMedia y la captura se hace sobre un
// <canvas> — en ningún momento se ofrece un selector de archivos, así que
// la galería del dispositivo queda inaccesible en todo momento.
export function LiveCameraCapture({ folder, onCaptured, onCancel, allowUpload = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [previewSource, setPreviewSource] = useState<"camera" | "upload">("camera");

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia(CAMERA_CONSTRAINTS)
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => setError("No se pudo acceder a la cámara. Revisá los permisos del navegador e intentá de nuevo."));

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  async function hashFile(file: File): Promise<string | undefined> {
    try {
      const buf = await file.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", buf);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } catch {
      return undefined;
    }
  }

  async function uploadPhoto(file: File) {
    setUploading(true);
    setUploadError("");
    const hash = await hashFile(file);
    const compressed = await compressImage(file);
    const result = await uploadFile(compressed, folder);
    setUploading(false);
    if (!result.ok) {
      setUploadError(result.error);
      return;
    }
    onCaptured(result.url, hash);
  }

  async function takePhoto() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) return;
    stopStream();
    setPreviewSource("camera");
    setPreviewUrl(URL.createObjectURL(blob));
    await uploadPhoto(new File([blob], `foto-${Date.now()}.jpg`, { type: "image/jpeg" }));
  }

  function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    stopStream();
    setPreviewSource("upload");
    setPreviewUrl(URL.createObjectURL(file));
    uploadPhoto(file);
  }

  function retake() {
    setPreviewUrl(null);
    setUploadError("");
    if (previewSource === "upload") {
      fileInputRef.current?.click();
      return;
    }
    navigator.mediaDevices
      .getUserMedia(CAMERA_CONSTRAINTS)
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => setError("No se pudo acceder a la cámara. Revisá los permisos del navegador e intentá de nuevo."));
  }

  return (
    <div className="bg-cloud border border-rule rounded-md p-3">
      {allowUpload && <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFilePicked} />}
      {error ? (
        <div>
          <div className="text-red text-[12.5px] mb-2">{error}</div>
          {allowUpload && (
            <button
              type="button"
              className="flex items-center gap-1.5 text-[12.5px] font-bold bg-blue text-white rounded-md px-3.5 py-2 cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={14} /> Subir foto
            </button>
          )}
        </div>
      ) : previewUrl ? (
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="Foto tomada" className="w-full max-w-xs aspect-[4/3] object-cover rounded-md" />
          {uploading && <div className="text-[11.5px] text-steel-dim mt-2">Subiendo…</div>}
          {uploadError && (
            <div className="mt-2">
              <div className="text-red text-[12px] mb-1.5">{uploadError}</div>
              <button type="button" className="flex items-center gap-1 text-[12px] font-semibold text-blue cursor-pointer" onClick={retake}>
                <RefreshCw size={12} /> Reintentar
              </button>
            </div>
          )}
        </div>
      ) : (
        <div>
          <video ref={videoRef} autoPlay playsInline muted className="w-full max-w-xs aspect-[4/3] object-cover rounded-md bg-black" />
          <div className="flex items-center gap-2 mt-2.5">
            <button
              type="button"
              className="flex items-center gap-1.5 text-[12.5px] font-bold bg-blue text-white rounded-md px-3.5 py-2 cursor-pointer"
              onClick={takePhoto}
            >
              <Camera size={14} /> Tomar foto
            </button>
            {allowUpload && (
              <button
                type="button"
                className="flex items-center gap-1.5 text-[12.5px] font-bold border-[1.5px] border-rule rounded-md px-3.5 py-2 cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={14} /> Subir foto
              </button>
            )}
            {onCancel && (
              <button type="button" className="flex items-center gap-1 text-[12px] text-steel cursor-pointer" onClick={() => { stopStream(); onCancel(); }}>
                <X size={12} /> Cancelar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
