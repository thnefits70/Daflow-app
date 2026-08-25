"use client";

import { useEffect, useRef, useState } from "react";
import { Circle, RefreshCw, Square, X } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";

type Props = {
  folder: string;
  onCaptured: (url: string) => void;
  onCancel?: () => void;
};

// Confirmado 2026-08-25: pedido explícito del usuario — el video de
// evidencia venía del selector nativo de cámara del celular, que graba a
// máxima calidad (varios MB por segundo) y no se puede comprimir después en
// el navegador sin una librería pesada (ffmpeg.wasm). En vez de eso, se graba
// EN VIVO acá mismo con MediaRecorder, controlando resolución y bitrate
// desde el inicio — el archivo sale chico de fábrica, mismo criterio que
// LiveCameraCapture usa para fotos (getUserMedia en vez del selector nativo).
const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: "environment", width: { ideal: 960 }, height: { ideal: 540 } },
  audio: true,
};

const MAX_SECONDS = 20;
const VIDEO_BITS_PER_SECOND = 800_000;

const MIME_CANDIDATES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];

function pickMimeType(): string {
  for (const type of MIME_CANDIDATES) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

export function LiveVideoCapture({ folder, onCaptured, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  function startPreviewStream() {
    navigator.mediaDevices
      .getUserMedia(CAMERA_CONSTRAINTS)
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => setError("No se pudo acceder a la cámara. Revisá los permisos del navegador e intentá de nuevo."));
  }

  useEffect(() => {
    startPreviewStream();
    return () => {
      stopStream();
      if (timerRef.current) clearInterval(timerRef.current);
      if (autoStopRef.current) clearTimeout(autoStopRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream) return;
    const mimeType = pickMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType, videoBitsPerSecond: VIDEO_BITS_PER_SECOND }) : new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => void finishRecording(recorder.mimeType || mimeType || "video/webm");
    recorderRef.current = recorder;
    recorder.start();
    setRecording(true);
    setSeconds(0);
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    autoStopRef.current = setTimeout(() => stopRecording(), MAX_SECONDS * 1000);
  }

  function stopRecording() {
    recorderRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    setRecording(false);
  }

  async function finishRecording(mimeType: string) {
    stopStream();
    const blob = new Blob(chunksRef.current, { type: mimeType });
    const ext = mimeType.includes("mp4") ? "mp4" : "webm";
    setPreviewUrl(URL.createObjectURL(blob));

    setUploading(true);
    setUploadError("");
    const file = new File([blob], `video-${Date.now()}.${ext}`, { type: mimeType });
    const result = await uploadFile(file, folder);
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
    setSeconds(0);
    startPreviewStream();
  }

  return (
    <div className="bg-cloud border border-rule rounded-md p-3">
      {error ? (
        <div className="text-red text-[12.5px]">{error}</div>
      ) : previewUrl ? (
        <div>
          <video src={previewUrl} controls className="w-full max-w-xs aspect-[16/9] object-cover rounded-md bg-black" />
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
          <video ref={videoRef} autoPlay playsInline muted className="w-full max-w-xs aspect-[16/9] object-cover rounded-md bg-black" />
          <div className="flex items-center gap-2 mt-2.5">
            {recording ? (
              <button
                type="button"
                className="flex items-center gap-1.5 text-[12.5px] font-bold bg-red text-white rounded-md px-3.5 py-2 cursor-pointer"
                onClick={stopRecording}
              >
                <Square size={12} /> Detener ({MAX_SECONDS - seconds}s)
              </button>
            ) : (
              <button
                type="button"
                className="flex items-center gap-1.5 text-[12.5px] font-bold bg-blue text-white rounded-md px-3.5 py-2 cursor-pointer"
                onClick={startRecording}
              >
                <Circle size={12} /> Grabar video
              </button>
            )}
            {onCancel && (
              <button type="button" className="flex items-center gap-1 text-[12px] text-steel cursor-pointer" onClick={() => { stopRecording(); stopStream(); onCancel(); }}>
                <X size={12} /> Cancelar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
