-- CreateTable
CREATE TABLE "PlatformUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'SUPER_ADMIN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Hospital" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalBusinessName" TEXT,
    "ntn" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "numberOfBeds" INTEGER NOT NULL DEFAULT 0,
    "declaredBranches" INTEGER NOT NULL DEFAULT 1,
    "primaryContactName" TEXT,
    "primaryContactDesignation" TEXT,
    "primaryContactMobile" TEXT,
    "primaryContactEmail" TEXT,
    "accountStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "HospitalBranch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hospitalId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "HospitalBranch_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HospitalRole" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hospitalId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "HospitalRole_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HospitalRolePermission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hospitalId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "canRead" BOOLEAN NOT NULL DEFAULT false,
    "canWrite" BOOLEAN NOT NULL DEFAULT false,
    "canManage" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "HospitalRolePermission_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HospitalRolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "HospitalRole" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HospitalUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hospitalId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "mobile" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "HospitalUser_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HospitalUser_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "HospitalRole" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SubscriptionPlanVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "monthlyPrice" DECIMAL NOT NULL DEFAULT 0,
    "annualPrice" DECIMAL NOT NULL DEFAULT 0,
    "defaultImplementationFee" DECIMAL NOT NULL DEFAULT 0,
    "maxUsers" INTEGER,
    "maxBranches" INTEGER,
    "maxBeds" INTEGER,
    "storageLimitMb" INTEGER,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SubscriptionPlanVersion_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlanFeature" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planVersionId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isAddOn" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "PlanFeature_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "SubscriptionPlanVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HospitalSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hospitalId" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "billingCycle" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "trialEndsAt" DATETIME,
    "currentPeriodStart" DATETIME,
    "currentPeriodEnd" DATETIME,
    "nextBillingDate" DATETIME,
    "gracePeriodEndsAt" DATETIME,
    "contractRenewalDate" DATETIME,
    "canceledAt" DATETIME,
    "price" DECIMAL NOT NULL,
    "discount" DECIMAL NOT NULL DEFAULT 0,
    "taxRate" DECIMAL NOT NULL DEFAULT 0,
    "implementationFee" DECIMAL NOT NULL DEFAULT 0,
    "implementationFeeStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "invoiceDueDays" INTEGER NOT NULL DEFAULT 7,
    "gracePeriodDays" INTEGER NOT NULL DEFAULT 7,
    "suspensionAfterDays" INTEGER NOT NULL DEFAULT 30,
    "maxUsers" INTEGER,
    "maxBranches" INTEGER,
    "maxBeds" INTEGER,
    "storageLimitMb" INTEGER,
    "notes" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "HospitalSubscription_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HospitalSubscription_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "SubscriptionPlanVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HospitalFeatureOverride" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hospitalId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "featureKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "changedByPlatformUserId" TEXT NOT NULL,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "HospitalFeatureOverride_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HospitalFeatureOverride_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "HospitalSubscription" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SubscriptionInvoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hospitalId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceType" TEXT NOT NULL,
    "issueDate" DATETIME NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "billingPeriodStart" DATETIME,
    "billingPeriodEnd" DATETIME,
    "currency" TEXT NOT NULL DEFAULT 'PKR',
    "subtotal" DECIMAL NOT NULL,
    "discount" DECIMAL NOT NULL DEFAULT 0,
    "tax" DECIMAL NOT NULL DEFAULT 0,
    "total" DECIMAL NOT NULL,
    "paidAmount" DECIMAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "paymentInstructions" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "issuedAt" DATETIME,
    "voidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SubscriptionInvoice_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SubscriptionInvoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "HospitalSubscription" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SubscriptionInvoiceItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hospitalId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL NOT NULL DEFAULT 1,
    "unitAmount" DECIMAL NOT NULL,
    "lineTotal" DECIMAL NOT NULL,
    CONSTRAINT "SubscriptionInvoiceItem_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SubscriptionInvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SubscriptionInvoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SubscriptionPayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hospitalId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "bankTransferProofId" TEXT,
    "provider" TEXT NOT NULL,
    "paymentReference" TEXT NOT NULL,
    "normalizedReference" TEXT NOT NULL,
    "providerTransactionId" TEXT,
    "amount" DECIMAL NOT NULL,
    "paidAt" DATETIME NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SubscriptionPayment_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SubscriptionPayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SubscriptionInvoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SubscriptionPayment_bankTransferProofId_fkey" FOREIGN KEY ("bankTransferProofId") REFERENCES "BankTransferProof" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BankTransferProof" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hospitalId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "submittedByHospitalUserId" TEXT NOT NULL,
    "parentProofId" TEXT,
    "amount" DECIMAL NOT NULL,
    "bankName" TEXT NOT NULL,
    "transactionReference" TEXT NOT NULL,
    "normalizedReference" TEXT NOT NULL,
    "transferDate" DATETIME NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "additionalInformation" TEXT,
    "reviewedByPlatformUserId" TEXT,
    "reviewedAt" DATETIME,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BankTransferProof_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BankTransferProof_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SubscriptionInvoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BankTransferProof_parentProofId_fkey" FOREIGN KEY ("parentProofId") REFERENCES "BankTransferProof" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentProviderConfiguration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "demoMode" BOOLEAN NOT NULL DEFAULT true,
    "publicConfigJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "sanitizedPayload" TEXT NOT NULL,
    "signatureVerified" BOOLEAN NOT NULL DEFAULT false,
    "processingStatus" TEXT NOT NULL DEFAULT 'RECEIVED',
    "processedAt" DATETIME,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hospitalId" TEXT,
    "hospitalUserId" TEXT,
    "platformUserId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "link" TEXT,
    "dedupeKey" TEXT,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_hospitalUserId_fkey" FOREIGN KEY ("hospitalUserId") REFERENCES "HospitalUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_platformUserId_fkey" FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hospitalId" TEXT,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "previousValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT,
    "ipAddress" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SupportAccessSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platformUserId" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "warningAccepted" BOOLEAN NOT NULL DEFAULT true,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    "endedById" TEXT,
    "ipAddress" TEXT,
    CONSTRAINT "SupportAccessSession_platformUserId_fkey" FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SupportAccessSession_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SupportRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hospitalId" TEXT NOT NULL,
    "hospitalUserId" TEXT,
    "subject" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "assignedPlatformUserId" TEXT,
    "response" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SupportRequest_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updatedById" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "HospitalSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hospitalId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HospitalSetting_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "principalType" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hospitalId" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "age" INTEGER,
    "gender" TEXT NOT NULL,
    "phone" TEXT,
    "city" TEXT,
    "bloodGroup" TEXT,
    "cnic" TEXT,
    "payer" TEXT NOT NULL DEFAULT 'Self Pay',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Patient_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hospitalId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "headDoctorName" TEXT,
    "monthlyPatientCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Department_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Doctor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hospitalId" TEXT NOT NULL,
    "departmentId" TEXT,
    "displayCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specialty" TEXT NOT NULL,
    "phone" TEXT,
    "fee" DECIMAL NOT NULL DEFAULT 0,
    "availability" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Doctor_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Doctor_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hospitalId" TEXT NOT NULL,
    "departmentId" TEXT,
    "displayCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "departmentName" TEXT NOT NULL,
    "price" DECIMAL NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Service_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Service_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hospitalId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT,
    "departmentId" TEXT,
    "displayCode" TEXT NOT NULL,
    "visitType" TEXT NOT NULL,
    "appointmentDate" DATETIME NOT NULL,
    "appointmentTime" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Appointment_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Appointment_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Appointment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Admission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hospitalId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT,
    "displayCode" TEXT NOT NULL,
    "ward" TEXT NOT NULL,
    "room" TEXT NOT NULL,
    "bed" TEXT NOT NULL,
    "admittedAt" DATETIME NOT NULL,
    "billingPackage" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Admission_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Admission_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Admission_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PatientInvoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hospitalId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" DATETIME NOT NULL,
    "payer" TEXT NOT NULL,
    "total" DECIMAL NOT NULL,
    "paidAmount" DECIMAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "visitType" TEXT NOT NULL,
    "discount" DECIMAL NOT NULL DEFAULT 0,
    "insurance" DECIMAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PatientInvoice_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PatientInvoice_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PatientInvoiceItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hospitalId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "serviceId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL NOT NULL,
    "lineTotal" DECIMAL NOT NULL,
    CONSTRAINT "PatientInvoiceItem_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PatientInvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PatientInvoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PatientInvoiceItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PatientPayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hospitalId" TEXT NOT NULL,
    "patientId" TEXT,
    "invoiceId" TEXT,
    "paymentNumber" TEXT NOT NULL,
    "paymentDate" DATETIME NOT NULL,
    "method" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "status" TEXT NOT NULL,
    "reference" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PatientPayment_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PatientPayment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PatientPayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PatientInvoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PatientReceipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hospitalId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PatientReceipt_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PatientReceipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "PatientPayment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformUser_email_key" ON "PlatformUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Hospital_code_key" ON "Hospital"("code");

-- CreateIndex
CREATE INDEX "HospitalBranch_hospitalId_idx" ON "HospitalBranch"("hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "HospitalBranch_hospitalId_code_key" ON "HospitalBranch"("hospitalId", "code");

-- CreateIndex
CREATE INDEX "HospitalRole_hospitalId_idx" ON "HospitalRole"("hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "HospitalRole_hospitalId_key_key" ON "HospitalRole"("hospitalId", "key");

-- CreateIndex
CREATE INDEX "HospitalRolePermission_hospitalId_featureKey_idx" ON "HospitalRolePermission"("hospitalId", "featureKey");

-- CreateIndex
CREATE UNIQUE INDEX "HospitalRolePermission_roleId_featureKey_key" ON "HospitalRolePermission"("roleId", "featureKey");

-- CreateIndex
CREATE INDEX "HospitalUser_hospitalId_roleId_idx" ON "HospitalUser"("hospitalId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "HospitalUser_hospitalId_email_key" ON "HospitalUser"("hospitalId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_code_key" ON "SubscriptionPlan"("code");

-- CreateIndex
CREATE INDEX "SubscriptionPlanVersion_planId_isPublished_idx" ON "SubscriptionPlanVersion"("planId", "isPublished");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlanVersion_planId_version_key" ON "SubscriptionPlanVersion"("planId", "version");

-- CreateIndex
CREATE INDEX "PlanFeature_featureKey_idx" ON "PlanFeature"("featureKey");

-- CreateIndex
CREATE UNIQUE INDEX "PlanFeature_planVersionId_featureKey_key" ON "PlanFeature"("planVersionId", "featureKey");

-- CreateIndex
CREATE INDEX "HospitalSubscription_hospitalId_isCurrent_idx" ON "HospitalSubscription"("hospitalId", "isCurrent");

-- CreateIndex
CREATE INDEX "HospitalSubscription_status_nextBillingDate_idx" ON "HospitalSubscription"("status", "nextBillingDate");

-- CreateIndex
CREATE INDEX "HospitalFeatureOverride_hospitalId_idx" ON "HospitalFeatureOverride"("hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "HospitalFeatureOverride_hospitalId_featureKey_key" ON "HospitalFeatureOverride"("hospitalId", "featureKey");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionInvoice_invoiceNumber_key" ON "SubscriptionInvoice"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionInvoice_idempotencyKey_key" ON "SubscriptionInvoice"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SubscriptionInvoice_hospitalId_status_idx" ON "SubscriptionInvoice"("hospitalId", "status");

-- CreateIndex
CREATE INDEX "SubscriptionInvoice_subscriptionId_billingPeriodStart_idx" ON "SubscriptionInvoice"("subscriptionId", "billingPeriodStart");

-- CreateIndex
CREATE INDEX "SubscriptionInvoiceItem_hospitalId_invoiceId_idx" ON "SubscriptionInvoiceItem"("hospitalId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPayment_bankTransferProofId_key" ON "SubscriptionPayment"("bankTransferProofId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPayment_receiptNumber_key" ON "SubscriptionPayment"("receiptNumber");

-- CreateIndex
CREATE INDEX "SubscriptionPayment_hospitalId_paidAt_idx" ON "SubscriptionPayment"("hospitalId", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPayment_provider_normalizedReference_key" ON "SubscriptionPayment"("provider", "normalizedReference");

-- CreateIndex
CREATE INDEX "BankTransferProof_hospitalId_status_idx" ON "BankTransferProof"("hospitalId", "status");

-- CreateIndex
CREATE INDEX "BankTransferProof_normalizedReference_idx" ON "BankTransferProof"("normalizedReference");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentProviderConfiguration_provider_key" ON "PaymentProviderConfiguration"("provider");

-- CreateIndex
CREATE INDEX "WebhookEvent_processingStatus_createdAt_idx" ON "WebhookEvent"("processingStatus", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_providerEventId_key" ON "WebhookEvent"("provider", "providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_hospitalId_createdAt_idx" ON "Notification"("hospitalId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_hospitalId_createdAt_idx" ON "AuditLog"("hospitalId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "SupportAccessSession_platformUserId_endedAt_idx" ON "SupportAccessSession"("platformUserId", "endedAt");

-- CreateIndex
CREATE INDEX "SupportAccessSession_hospitalId_endedAt_idx" ON "SupportAccessSession"("hospitalId", "endedAt");

-- CreateIndex
CREATE INDEX "SupportRequest_status_priority_idx" ON "SupportRequest"("status", "priority");

-- CreateIndex
CREATE INDEX "SupportRequest_hospitalId_createdAt_idx" ON "SupportRequest"("hospitalId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformSetting_key_key" ON "PlatformSetting"("key");

-- CreateIndex
CREATE UNIQUE INDEX "HospitalSetting_hospitalId_key_key" ON "HospitalSetting"("hospitalId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_principalType_principalId_idx" ON "PasswordResetToken"("principalType", "principalId");

-- CreateIndex
CREATE INDEX "Patient_hospitalId_name_idx" ON "Patient"("hospitalId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_hospitalId_displayCode_key" ON "Patient"("hospitalId", "displayCode");

-- CreateIndex
CREATE UNIQUE INDEX "Department_hospitalId_code_key" ON "Department"("hospitalId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Department_hospitalId_name_key" ON "Department"("hospitalId", "name");

-- CreateIndex
CREATE INDEX "Doctor_hospitalId_name_idx" ON "Doctor"("hospitalId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Doctor_hospitalId_displayCode_key" ON "Doctor"("hospitalId", "displayCode");

-- CreateIndex
CREATE INDEX "Service_hospitalId_category_idx" ON "Service"("hospitalId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Service_hospitalId_displayCode_key" ON "Service"("hospitalId", "displayCode");

-- CreateIndex
CREATE INDEX "Appointment_hospitalId_appointmentDate_idx" ON "Appointment"("hospitalId", "appointmentDate");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_hospitalId_displayCode_key" ON "Appointment"("hospitalId", "displayCode");

-- CreateIndex
CREATE INDEX "Admission_hospitalId_admittedAt_idx" ON "Admission"("hospitalId", "admittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Admission_hospitalId_displayCode_key" ON "Admission"("hospitalId", "displayCode");

-- CreateIndex
CREATE INDEX "PatientInvoice_hospitalId_status_idx" ON "PatientInvoice"("hospitalId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PatientInvoice_hospitalId_invoiceNumber_key" ON "PatientInvoice"("hospitalId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "PatientInvoiceItem_hospitalId_invoiceId_idx" ON "PatientInvoiceItem"("hospitalId", "invoiceId");

-- CreateIndex
CREATE INDEX "PatientPayment_hospitalId_paymentDate_idx" ON "PatientPayment"("hospitalId", "paymentDate");

-- CreateIndex
CREATE UNIQUE INDEX "PatientPayment_hospitalId_paymentNumber_key" ON "PatientPayment"("hospitalId", "paymentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PatientReceipt_paymentId_key" ON "PatientReceipt"("paymentId");

-- CreateIndex
CREATE INDEX "PatientReceipt_hospitalId_idx" ON "PatientReceipt"("hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "PatientReceipt_hospitalId_receiptNumber_key" ON "PatientReceipt"("hospitalId", "receiptNumber");
