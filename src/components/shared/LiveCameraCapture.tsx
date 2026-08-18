"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, RefreshCw, X } from "lucide-react";
import { compressImage } from "@/lib/compressImage";
import { uploadFile } from "@/lib/uploadFile";

type Props = {
  folder: string;
  onCaptured: (url: string) => void;
  onCancel?: () => void;
};

// Confirmado 2026-08-18: pedido explícito del usuario — la foto de una
// compra personal tiene que ser tomada EN VIVO, nunca elegida de la
// galería. Ningún sistema web puede garantizarlo al 100% (alguien podría
// fotografiar una foto), pero esto es lo más cercano: la cámara se abre
// DENTRO de esta pantalla con getUserMedia y la captura se hace sobre un
// <canvas> — en ningún momento se ofrece un selector de archivos, así que
// la galería del dispositivo queda inaccesible en todo momento.
export function LiveCameraCapture({ folder, onCaptured, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
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
    setPreviewUrl(URL.createObjectURL(blob));

    setUploading(true);
    setUploadError("");
    const file = new File([blob], `foto-${Date.now()}.jpg`, { type: "image/jpeg" });
    const compressed = await compressImage(file);
    const result = await uploadFile(compressed, folder);
    setUploading(false);
    if (!result.ok) {
      setUploadError(result.error);
      return;
    }
    onCaptured(result.url);
  }

  function retake() {
    setPreviewUrl(null);
    setUploadError("");
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => setError("No se pudo acceder a la cámara. Revisá los permisos del navegador e intentá de nuevo."));
  }

  return (
    <div className="bg-cloud border border-rule rounded-md p-3">
      {error ? (
        <div className="text-red text-[12.5px]">{error}</div>
      ) : previewUrl ? (
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="Foto tomada" className="w-full max-w-xs rounded-md" />
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
          <video ref={videoRef} autoPlay playsInline muted className="w-full max-w-xs rounded-md bg-black" />
          <div className="flex items-center gap-2 mt-2.5">
            <button
              type="button"
              className="flex items-center gap-1.5 text-[12.5px] font-bold bg-blue text-white rounded-md px-3.5 py-2 cursor-pointer"
              onClick={takePhoto}
            >
              <Camera size={14} /> Tomar foto
            </button>
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
