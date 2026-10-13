-- Tareas del equipo (pedido de Bryan Ríos 2026-10-13).
-- CreateEnum
CREATE TYPE "TeamTaskStatus" AS ENUM ('POR_HACER', 'EN_PROCESO', 'HECHA', 'DEVUELTA', 'APROBADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "TeamTaskEventKind" AS ENUM ('CREADA', 'EMPEZADA', 'HECHA', 'DEVUELTA', 'APROBADA', 'CANCELADA');

-- CreateTable
CREATE TABLE "TeamTask" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" DATE NOT NULL,
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "attachmentUrl" TEXT,
    "attachmentName" TEXT,
    "deptId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamTaskAssignment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "status" "TeamTaskStatus" NOT NULL DEFAULT 'POR_HACER',
    "startedAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "doneComment" TEXT,
    "donePhotoUrl" TEXT,
    "returnedAt" TIMESTAMP(3),
    "returnComment" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "overdueNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamTaskAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamTaskEvent" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "kind" "TeamTaskEventKind" NOT NULL,
    "comment" TEXT,
    "photoUrl" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamTaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamTask_deptId_idx" ON "TeamTask"("deptId");

-- CreateIndex
CREATE INDEX "TeamTaskAssignment_assigneeId_status_idx" ON "TeamTaskAssignment"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "TeamTaskAssignment_status_idx" ON "TeamTaskAssignment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TeamTaskAssignment_taskId_assigneeId_key" ON "TeamTaskAssignment"("taskId", "assigneeId");

-- CreateIndex
CREATE INDEX "TeamTaskEvent_assignmentId_idx" ON "TeamTaskEvent"("assignmentId");

-- AddForeignKey
ALTER TABLE "TeamTask" ADD CONSTRAINT "TeamTask_deptId_fkey" FOREIGN KEY ("deptId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamTask" ADD CONSTRAINT "TeamTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamTaskAssignment" ADD CONSTRAINT "TeamTaskAssignment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "TeamTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamTaskAssignment" ADD CONSTRAINT "TeamTaskAssignment_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamTaskAssignment" ADD CONSTRAINT "TeamTaskAssignment_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamTaskEvent" ADD CONSTRAINT "TeamTaskEvent_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "TeamTaskAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamTaskEvent" ADD CONSTRAINT "TeamTaskEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Igual que el resto de tablas: sin acceso por la API REST de Supabase.
ALTER TABLE "TeamTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TeamTaskAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TeamTaskEvent" ENABLE ROW LEVEL SECURITY;
