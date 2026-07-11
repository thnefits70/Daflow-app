export function DaflowMark({ size = 34, light = false }: { size?: number; light?: boolean }) {
  const step1 = light ? "#FFFFFF" : "#0B1F3A";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="8" y="40" width="16" height="16" rx="4" fill={step1} />
      <rect x="24" y="24" width="16" height="16" rx="4" fill="#1E5EFF" />
      <rect x="40" y="8" width="16" height="16" rx="4" fill="#14C7C7" />
    </svg>
  );
}

export function DaflowWordmark({ light = false, showTag = true }: { light?: boolean; showTag?: boolean }) {
  return (
    <div>
      <div
        className="font-display font-bold leading-none"
        style={{ fontSize: 19, letterSpacing: ".01em", color: light ? "#fff" : "#0B1F3A" }}
      >
        DAFLOW
      </div>
      {showTag && (
        <div className="font-mono" style={{ fontSize: 8.5, letterSpacing: ".12em", color: "#14C7C7", marginTop: 3 }}>
          PROCESS STANDARDIZATION
        </div>
      )}
    </div>
  );
}

export function BrandMark({
  logoUrl,
  size = 34,
  light = false,
  chip = false,
}: {
  logoUrl?: string | null;
  size?: number;
  light?: boolean;
  chip?: boolean;
}) {
  if (logoUrl) {
    return (
      <div
        className="flex items-center justify-center shrink-0 overflow-hidden rounded-lg"
        style={{ width: size, height: size, background: chip ? "#fff" : "transparent", padding: chip ? 3 : 0 }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl} alt="Logo" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
      </div>
    );
  }
  return <DaflowMark size={size} light={light} />;
}
