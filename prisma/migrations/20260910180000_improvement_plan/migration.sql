-- CreateEnum
CREATE TYPE "ImprovementPlanStage" AS ENUM ('PRIMER_PERIODO', 'EXTENDIDO', 'ETAPA_FINAL', 'CERRADO');

-- CreateEnum
CREATE TYPE "ImprovementPlanOutcome" AS ENUM ('CONTINUIDAD', 'REUBICACION', 'REVISION_CONTINUIDAD');

-- CreateEnum
CREATE TYPE "ImprovementPlanCommitmentResponsible" AS ENUM ('COLABORADOR', 'LIDER');

-- CreateEnum
CREATE TYPE "ImprovementPlanSemaforo" AS ENUM ('VERDE', 'AMARILLO', 'NARANJA', 'ROJO');

-- CreateTable
CREATE TABLE "ImprovementPlan" (
    "id" TEXT NOT NULL,
    "collaboratorId" TEXT NOT NULL,
    "leaderId" TEXT,
    "deptId" TEXT NOT NULL,
    "situacion" TEXT NOT NULL,
    "resultadoEsperado" TEXT NOT NULL,
    "stage" "ImprovementPlanStage" NOT NULL DEFAULT 'PRIMER_PERIODO',
    "stageDurationDays" INTEGER NOT NULL DEFAULT 15,
    "stageStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stageDeadline" TIMESTAMP(3) NOT NULL,
    "outcome" "ImprovementPlanOutcome",
    "closureNotes" TEXT,
    "closedAt" TIMESTAMP(3),
    "pendingClosureOutcome" "ImprovementPlanOutcome",
    "pendingClosureNotes" TEXT,
    "pendingClosureRequestedAt" TIMESTAMP(3),
    "pendingClosureRequestedById" TEXT,
    "pendingClosureRejectedAt" TIMESTAMP(3),
    "adminApprovedAt" TIMESTAMP(3),
    "adminApprovedById" TEXT,
    "finalStageNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImprovementPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImprovementPlanCommitment" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "indicador" TEXT NOT NULL,
    "meta" TEXT NOT NULL,
    "responsable" "ImprovementPlanCommitmentResponsible" NOT NULL DEFAULT 'COLABORADOR',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImprovementPlanCommitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImprovementPlanReview" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "weekOf" TIMESTAMP(3) NOT NULL,
    "scores" JSONB NOT NULL,
    "avgScore" DOUBLE PRECISION NOT NULL,
    "semaforo" "ImprovementPlanSemaforo" NOT NULL,
    "queMejoro" TEXT NOT NULL,
    "queFalta" TEXT NOT NULL,
    "accionSiguiente" TEXT NOT NULL,
    "apoyoLider" TEXT NOT NULL,
    "aiAssisted" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImprovementPlanReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImprovementPlan_collaboratorId_idx" ON "ImprovementPlan"("collaboratorId");

-- CreateIndex
CREATE INDEX "ImprovementPlan_deptId_idx" ON "ImprovementPlan"("deptId");

-- CreateIndex
CREATE INDEX "ImprovementPlan_stage_idx" ON "ImprovementPlan"("stage");

-- CreateIndex
CREATE INDEX "ImprovementPlanCommitment_planId_idx" ON "ImprovementPlanCommitment"("planId");

-- CreateIndex
CREATE INDEX "ImprovementPlanReview_planId_idx" ON "ImprovementPlanReview"("planId");

-- CreateIndex
CREATE INDEX "ImprovementPlanReview_weekOf_idx" ON "ImprovementPlanReview"("weekOf");

-- AddForeignKey
ALTER TABLE "ImprovementPlan" ADD CONSTRAINT "ImprovementPlan_collaboratorId_fkey" FOREIGN KEY ("collaboratorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImprovementPlan" ADD CONSTRAINT "ImprovementPlan_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImprovementPlan" ADD CONSTRAINT "ImprovementPlan_deptId_fkey" FOREIGN KEY ("deptId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImprovementPlan" ADD CONSTRAINT "ImprovementPlan_pendingClosureRequestedById_fkey" FOREIGN KEY ("pendingClosureRequestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImprovementPlan" ADD CONSTRAINT "ImprovementPlan_adminApprovedById_fkey" FOREIGN KEY ("adminApprovedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImprovementPlanCommitment" ADD CONSTRAINT "ImprovementPlanCommitment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ImprovementPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImprovementPlanReview" ADD CONSTRAINT "ImprovementPlanReview_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ImprovementPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImprovementPlanReview" ADD CONSTRAINT "ImprovementPlanReview_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

