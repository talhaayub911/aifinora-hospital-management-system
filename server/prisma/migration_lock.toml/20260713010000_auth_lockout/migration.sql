-- Persist Super Admin lockouts so brute-force protection works across restarts
-- and across multiple API instances.
ALTER TABLE "PlatformUser" ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlatformUser" ADD COLUMN "lockedUntil" DATETIME;
