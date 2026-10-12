-- Seguridad (2026-10-12, aprobado por el usuario): los documentos sensibles se
-- copiaron al bucket privado "daflow-private" (misma ruta). Aquí sus enlaces
-- guardados pasan de la URL pública de Supabase a
-- https://www.daflow.app/api/files/<carpeta>/<archivo>, que exige sesión.
-- Ver src/lib/privateFiles.ts. Solo cambia el texto del enlace; ningún dato
-- de negocio se toca.

-- Carpetas: pay-stubs, cvs, payroll-individual-payment-proofs,
-- payroll-transfer-proofs, salary-advance-proofs,
-- payroll-message-attachments, personal-purchase-proofs, dropi-guides-pdf.

UPDATE "PayStub" SET "fileUrl" = regexp_replace("fileUrl", '^https://[^/]+/storage/v1/object/public/daflow-files/(pay-stubs)/', 'https://www.daflow.app/api/files/\1/') WHERE "fileUrl" LIKE '%/daflow-files/pay-stubs/%';

UPDATE "User" SET "cvUrl" = regexp_replace("cvUrl", '^https://[^/]+/storage/v1/object/public/daflow-files/(cvs)/', 'https://www.daflow.app/api/files/\1/') WHERE "cvUrl" LIKE '%/daflow-files/cvs/%';

UPDATE "MonthlyLegalRole" SET "payoutProofUrl" = regexp_replace("payoutProofUrl", '^https://[^/]+/storage/v1/object/public/daflow-files/(payroll-individual-payment-proofs)/', 'https://www.daflow.app/api/files/\1/') WHERE "payoutProofUrl" LIKE '%/daflow-files/payroll-individual-payment-proofs/%';

UPDATE "PayrollQuincenaRole" SET "paidProofUrl" = regexp_replace("paidProofUrl", '^https://[^/]+/storage/v1/object/public/daflow-files/(payroll-individual-payment-proofs)/', 'https://www.daflow.app/api/files/\1/') WHERE "paidProofUrl" LIKE '%/daflow-files/payroll-individual-payment-proofs/%';

UPDATE "PayrollMessage" SET "attachmentUrl" = regexp_replace("attachmentUrl", '^https://[^/]+/storage/v1/object/public/daflow-files/(payroll-message-attachments)/', 'https://www.daflow.app/api/files/\1/') WHERE "attachmentUrl" LIKE '%/daflow-files/payroll-message-attachments/%';

UPDATE "PayrollNairobySalaryTransfer" SET "proofUrl" = regexp_replace("proofUrl", '^https://[^/]+/storage/v1/object/public/daflow-files/(payroll-transfer-proofs)/', 'https://www.daflow.app/api/files/\1/') WHERE "proofUrl" LIKE '%/daflow-files/payroll-transfer-proofs/%';

UPDATE "PayrollTransfer" SET "proofUrl" = regexp_replace("proofUrl", '^https://[^/]+/storage/v1/object/public/daflow-files/(payroll-transfer-proofs)/', 'https://www.daflow.app/api/files/\1/') WHERE "proofUrl" LIKE '%/daflow-files/payroll-transfer-proofs/%';

UPDATE "SalaryAdvance" SET "transferProofUrl" = regexp_replace("transferProofUrl", '^https://[^/]+/storage/v1/object/public/daflow-files/(salary-advance-proofs)/', 'https://www.daflow.app/api/files/\1/') WHERE "transferProofUrl" LIKE '%/daflow-files/salary-advance-proofs/%';

UPDATE "PersonalPurchaseOrder" SET "transferProofUrl" = regexp_replace("transferProofUrl", '^https://[^/]+/storage/v1/object/public/daflow-files/(personal-purchase-proofs)/', 'https://www.daflow.app/api/files/\1/') WHERE "transferProofUrl" LIKE '%/daflow-files/personal-purchase-proofs/%';

UPDATE "FulfillmentRequestBatch"
SET "fileUrls" = ARRAY(
  SELECT regexp_replace(u, '^https://[^/]+/storage/v1/object/public/daflow-files/(dropi-guides-pdf)/', 'https://www.daflow.app/api/files/\1/')
  FROM unnest("fileUrls") WITH ORDINALITY AS t(u, i) ORDER BY i
)
WHERE array_to_string("fileUrls", ' ') LIKE '%/daflow-files/dropi-guides-pdf/%';
