-- Preserve the optional approval, claim, or visit reference entered when a
-- hospital creates a patient invoice.
ALTER TABLE "PatientInvoice" ADD COLUMN "notes" TEXT;
