export function DaflowMark({ size = 34, light = false }: { size?: number; light?: boolean }) {
  const line = light ? "#FFFFFF" : "#0B1F3A";
  const darkSquare = light ? "#14C7C7" : "#0B1F3A";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 44 V50 H20" stroke={line} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M26 34 V40 H34" stroke={line} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M40 24 V30 H46" stroke={line} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <rect x="6" y="38" width="12" height="12" rx="3" fill={darkSquare} />
      <rect x="20" y="28" width="12" height="12" rx="3" fill="#1E5EFF" />
      <rect x="34" y="18" width="12" height="12" rx="3" fill="#14C7C7" />
      <path d="M46 8 H54 L58 12 V26 H46 Z" stroke={line} strokeWidth="3" strokeLinejoin="round" fill={light ? "none" : "#fff"} />
      <line x1="49" y1="15" x2="55" y2="15" stroke={line} strokeWidth="2" strokeLinecap="round" />
      <line x1="49" y1="19" x2="55" y2="19" stroke={line} strokeWidth="2" strokeLinecap="round" />
      <line x1="49" y1="23" x2="52" y2="23" stroke={line} strokeWidth="2" strokeLinecap="round" />
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
