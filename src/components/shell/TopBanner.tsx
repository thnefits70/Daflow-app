"use client";

import { usePathname } from "next/navigation";

// Shown at the top of every logged-in page except Configuración, where the
// admin already manages this same image and doesn't need to see it repeated.
export function TopBanner({ bannerUrl }: { bannerUrl: string | null | undefined }) {
  const pathname = usePathname();
  if (!bannerUrl) return null;
  if (pathname.startsWith("/admin/settings")) return null;

  return (
    <div className="flex justify-center mb-6">
      <div className="bg-white rounded-lg shadow-md px-5 py-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={bannerUrl} alt="DAFLOW" className="h-14 w-auto object-contain block" />
      </div>
    </div>
  );
}
