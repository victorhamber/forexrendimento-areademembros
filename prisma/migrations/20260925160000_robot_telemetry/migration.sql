CREATE TABLE IF NOT EXISTS "RobotTelemetryEvent" (
  "id" SERIAL NOT NULL,
  "email" TEXT NOT NULL,
  "numeroConta" TEXT NOT NULL,
  "systemId" TEXT NOT NULL DEFAULT '',
  "corretora" TEXT NOT NULL DEFAULT '',
  "ativo" TEXT NOT NULL DEFAULT '',
  "kind" TEXT NOT NULL,
  "closeReason" TEXT NOT NULL DEFAULT '',
  "brokerTime" TEXT NOT NULL,
  "brokerOffsetMin" INTEGER NOT NULL DEFAULT 0,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "profitUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "floatUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "floatMinUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "floatMaxUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "eventKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RobotTelemetryEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RobotTelemetryEvent_eventKey_key" ON "RobotTelemetryEvent"("eventKey");
CREATE INDEX IF NOT EXISTS "RobotTelemetryEvent_email_numeroConta_occurredAt_idx" ON "RobotTelemetryEvent"("email", "numeroConta", "occurredAt");
CREATE INDEX IF NOT EXISTS "RobotTelemetryEvent_email_ativo_occurredAt_idx" ON "RobotTelemetryEvent"("email", "ativo", "occurredAt");
