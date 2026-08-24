import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canViewMerchandiseReentry, canCaptureMerchandiseReentry, canApproveMerchandiseReentry, canActOnMerchandiseReentry, canCloseMerchandiseReentry, canVerifyDamageDisposal, canManageJustUpload, canManageJustCatalog } from "@/lib/guards";
import { MerchandiseReentryPanel } from "@/components/merchandise-reentry/MerchandiseReentryPanel";

export default async function AreaMerchandiseReentryPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (!(await canViewMerchandiseReentry())) redirect("/area");

  const [canCapture, canApprove, canAct, canClose, canVerify, canManageUpload, canManageCatalog] = await Promise.all([
    canCaptureMerchandiseReentry(),
    canApproveMerchandiseReentry(),
    canActOnMerchandiseReentry(),
    canCloseMerchandiseReentry(),
    canVerifyDamageDisposal(),
    canManageJustUpload(),
    canManageJustCatalog(),
  ]);

  return (
    <MerchandiseReentryPanel
      canCapture={canCapture}
      canApprove={canApprove}
      canAct={canAct}
      canClose={canClose}
      canVerifyDamageDisposal={canVerify}
      canManageJustUpload={canManageUpload}
      canManageJustCatalog={canManageCatalog}
    />
  );
}
