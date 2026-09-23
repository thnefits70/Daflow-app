import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canViewMerchandiseReentry, canCaptureMerchandiseReentry, canApproveMerchandiseReentry, canActOnMerchandiseReentry, canCloseMerchandiseReentry, canVerifyDamageDisposal, canManageJustCatalog } from "@/lib/guards";
import { MerchandiseReentryPanel } from "@/components/merchandise-reentry/MerchandiseReentryPanel";

export default async function AreaMerchandiseReentryPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (!(await canViewMerchandiseReentry())) redirect("/area");

  const [canCapture, canApprove, canAct, canClose, canVerify, canManageCatalog] = await Promise.all([
    canCaptureMerchandiseReentry(),
    canApproveMerchandiseReentry(),
    canActOnMerchandiseReentry(),
    canCloseMerchandiseReentry(),
    canVerifyDamageDisposal(),
    canManageJustCatalog(),
  ]);

  return (
    <MerchandiseReentryPanel
      canCapture={canCapture}
      canApprove={canApprove}
      canAct={canAct}
      canClose={canClose}
      canVerifyDamageDisposal={canVerify}
      canManageJustCatalog={canManageCatalog}
    />
  );
}
