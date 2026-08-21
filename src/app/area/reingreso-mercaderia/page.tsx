import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canViewMerchandiseReentry, canCaptureMerchandiseReentry, canApproveMerchandiseReentry, canActOnMerchandiseReentry, canCloseMerchandiseReentry } from "@/lib/guards";
import { MerchandiseReentryPanel } from "@/components/merchandise-reentry/MerchandiseReentryPanel";

export default async function AreaMerchandiseReentryPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (!(await canViewMerchandiseReentry())) redirect("/area");

  const [canCapture, canApprove, canAct, canClose] = await Promise.all([
    canCaptureMerchandiseReentry(),
    canApproveMerchandiseReentry(),
    canActOnMerchandiseReentry(),
    canCloseMerchandiseReentry(),
  ]);

  return <MerchandiseReentryPanel canCapture={canCapture} canApprove={canApprove} canAct={canAct} canClose={canClose} />;
}
