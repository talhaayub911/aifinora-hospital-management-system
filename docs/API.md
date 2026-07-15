# AI Finora API reference

This document describes the HTTP contract implemented by the demonstration backend. It is intended for frontend integration, test automation, and a future production API review. It is not an OpenAPI specification and the current routes are not yet versioned for third-party consumers.

## Base URL and content types

- Local API: `http://localhost:3001/api`
- Docker Compose through the web proxy: `http://localhost:8080/api`
- JSON requests: `Content-Type: application/json`
- Bank proof upload: `multipart/form-data`
- Dates returned by the API are ISO 8601 strings. Date-only inputs use `YYYY-MM-DD`.
- Monetary values are decimal numbers in PKR unless an invoice says otherwise. A production accounting integration should transport amounts as integer minor units or decimal strings rather than binary floating-point values.

`GET /api/health` is unauthenticated and returns process liveness plus non-secret notification-channel capability flags. Its email status explicitly distinguishes disabled, simulated, and real-delivery capability; the included providers never report real delivery. This endpoint does not prove database readiness, so add a separate internal readiness probe before production rollout.

## Authentication

Successful login returns a signed JWT in `data.accessToken` and also sets the `ai_finora_session` HttpOnly cookie. Browser clients normally use the cookie; API clients may send:

```http
Authorization: Bearer <access-token>
```

The token contains the principal kind and, for hospital users, the tenant ID. The server reloads the user and derives `hospitalId` from the verified token. A hospital client must never be allowed to select another tenant by sending a `hospitalId` in its payload.

Account kinds are:

- `SUPER_ADMIN`: platform routes only
- `HOSPITAL`: routes for exactly one hospital tenant
- `SUPPORT`: explicit, time-limited, audited, read-only access to one hospital

New hospital administrators with `mustChangePassword=true` may use authentication routes but receive `403 PASSWORD_CHANGE_REQUIRED` from hospital-data routes until `POST /api/auth/change-password` succeeds.

For cross-origin browser deployments, set `CLIENT_ORIGIN` to the exact trusted frontend origin and send credentials. If cookie authentication remains enabled in production, complete a CSRF threat review; same-site deployment through the reverse proxy is preferred.

## Envelope and error model

Successful JSON responses use a data envelope:

```json
{
  "data": {
    "id": "example"
  }
}
```

Errors use one stable top-level shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request contains invalid data.",
    "details": [
      {
        "path": ["email"],
        "message": "Invalid email address"
      }
    ]
  }
}
```

Common status/code pairs:

| HTTP | Code | Meaning |
|---:|---|---|
| 400 | `BAD_REQUEST`, `VALIDATION_ERROR`, `UPLOAD_ERROR` | Invalid input or file |
| 401 | `UNAUTHORIZED` | Missing, invalid, expired, or revoked session |
| 403 | `FORBIDDEN`, `PASSWORD_CHANGE_REQUIRED` | Authenticated but not allowed |
| 404 | `NOT_FOUND`, `ROUTE_NOT_FOUND` | Resource or route not found |
| 409 | `CONFLICT`, `DUPLICATE_RECORD` | State transition or uniqueness conflict |
| 500 | `INTERNAL_ERROR` | Unexpected server failure; details are not exposed |

Clients should branch on `error.code`, show `error.message`, and treat `details` as optional. Do not parse English messages to determine behavior.

## Public and authentication routes

| Method | Route | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | Public | Liveness response |
| GET | `/api/payments/status?reference=...` | Public | Masked proof/payment lookup by invoice or reference |
| POST | `/api/auth/login` | Public | Sign in platform or hospital user |
| GET | `/api/auth/me` | Any session | Resolve the current principal/session |
| POST | `/api/auth/logout` | Public | Clear the browser session cookie |
| POST | `/api/auth/forgot-password` | Public | Create a reset request without disclosing account existence |
| POST | `/api/auth/reset-password` | Reset token | Consume a one-time reset token |
| POST | `/api/auth/change-password` | Hospital session | Replace current/temporary password and rotate token version |

Hospital login example:

```bash
curl -i http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{
    "hospitalCode": "akram-medical",
    "email": "hospitaladmin@example.com",
    "password": "Hospital@123",
    "rememberMe": false
  }'
```

Super Admin login omits `hospitalCode`:

```json
{
  "email": "admin@aifinora.com",
  "password": "Admin@123",
  "rememberMe": false
}
```

The reset token is returned as `demoResetToken` only while `DEMO_MODE=true`. A production build must deliver a single-use link through an email provider and must never return the raw token to the requester.

## Hospital route matrix

Every route below requires a hospital or valid support-access session. Role permission, enabled feature, and subscription-state checks are applied in addition to authentication. Support access is read-only.

| Method | Route | Required feature/action | Purpose |
|---|---|---|---|
| GET | `/api/hospital/bootstrap` | Per-resource filtering | Hospital shell, effective access, and permitted operational data |
| GET, POST | `/api/hospital/patients` | `patient_registration` read/write | List or register patients |
| PATCH | `/api/hospital/patients/:id` | `patient_registration` write | Edit a tenant patient |
| GET, POST | `/api/hospital/departments` | `departments` read/write | Departments |
| PATCH | `/api/hospital/departments/:id` | `departments` write | Edit a tenant department |
| GET, POST | `/api/hospital/doctors` | `doctors` read/write | Doctors |
| PATCH | `/api/hospital/doctors/:id` | `doctors` write | Edit a tenant doctor |
| GET, POST | `/api/hospital/services` | `charge_master` read/write | Charge master |
| PATCH | `/api/hospital/services/:id` | `charge_master` write | Edit a service |
| GET, POST | `/api/hospital/appointments` | `appointments` read/write | Appointments |
| PATCH | `/api/hospital/appointments/:id` | `appointments` write | Update appointment state/details |
| GET, POST | `/api/hospital/admissions` | `admissions` read/write | Admissions |
| PATCH | `/api/hospital/admissions/:id` | `admissions` write | Update an admission |
| GET | `/api/hospital/patient-invoices` | Any permitted patient-billing read feature | Patient invoice list |
| POST | `/api/hospital/patient-invoices` | Billing feature selected by visit type | Create a patient invoice, including optional notes/reference |
| GET, POST | `/api/hospital/patient-payments` | `payments` read/write | Patient payments and receipts |
| GET, POST | `/api/hospital/patient-refunds` | `refunds` read/write | List or record a refund against an original payment |
| GET, POST | `/api/hospital/users` | `user_management` manage | Hospital user list/create |
| PATCH | `/api/hospital/users/:id` | `user_management` manage | Enable/disable a tenant user and revoke sessions |
| GET, POST | `/api/hospital/branches` | `multi_branch_management` read/manage | List or create tenant branches within plan limits |
| PATCH | `/api/hospital/branches/:id` | `multi_branch_management` manage | Edit, enable, or disable a tenant branch |
| GET, POST | `/api/hospital/pharmacy-inventory` | `pharmacy_inventory` read/write | Tenant pharmacy stock list/create |
| PATCH | `/api/hospital/pharmacy-inventory/:id` | `pharmacy_inventory` write | Update a tenant stock item |
| GET, POST | `/api/hospital/data-export-requests` | `data_export` read/write | List or request a reviewed data export |
| GET | `/api/hospital/subscription` | `subscription_billing` read | Plan, status, limits, modules, SaaS invoices, and proofs |
| GET | `/api/hospital/subscription-invoices/:id` | `subscription_billing` read | One SaaS invoice by ID or number |
| POST | `/api/hospital/subscription-invoices/:id/safepay-link` | `subscription_billing` write | Hosted-payment link or clearly marked demo response |
| POST | `/api/hospital/bank-transfer-proofs` | `subscription_billing` write | Submit/resubmit a private payment proof |
| GET | `/api/hospital/payment-proofs/:id/file` | `subscription_billing` read | Stream a proof owned by this tenant |
| POST | `/api/hospital/support-requests` | `support` write | Create a support request |

The update routes look up the target with both its identifier and the authenticated tenant ID. A resource ID from another hospital therefore returns `404` and is never updated. Plan limits are enforced server-side when activating/creating users or branches; hiding a frontend button is not an authorization control.

Create a patient example:

```bash
curl http://localhost:3001/api/hospital/patients \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Demo Patient",
    "age": 34,
    "gender": "Female",
    "phone": "+92-300-0000000",
    "city": "Lahore"
  }'
```

Payment-proof upload example:

```bash
curl http://localhost:3001/api/hospital/bank-transfer-proofs \
  -H "Authorization: Bearer $TOKEN" \
  -F 'invoiceId=<invoice-id-or-number>' \
  -F 'amount=75000' \
  -F 'bankName=Demo Bank' \
  -F 'transactionReference=DEMO-TRANSFER-10001' \
  -F 'transferDate=2026-07-13' \
  -F 'proof=@./receipt.png;type=image/png'
```

The field name must be `proof`. PNG, JPEG, and PDF are accepted up to `MAX_UPLOAD_BYTES`. File extension, MIME declaration, and magic bytes are checked. Files are stored outside the public frontend and fetched only through authenticated routes. Add malware scanning and private object storage before production.

For a rejected-proof resubmission, send a new unique reference/file plus `parentProofId=<rejected-proof-id>` in the multipart form.

## Super Admin route matrix

All routes require a valid platform `SUPER_ADMIN` session. These endpoints administer SaaS metadata; normal platform pages must not retrieve patient medical or patient billing data.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/super-admin/overview` | SaaS metrics, revenue series, signups, payments |
| GET | `/api/super-admin/dashboard` | Alias of overview |
| GET | `/api/super-admin/features` | Configurable feature-key catalog |
| GET, POST | `/api/super-admin/hospitals` | Search/filter hospitals; transactional onboarding |
| GET, PATCH | `/api/super-admin/hospitals/:id` | Hospital commercial detail; edit metadata/modules/notes |
| POST | `/api/super-admin/hospitals/:id/access-state` | Audited read-only/suspend/reactivate/etc. transition |
| GET, POST | `/api/super-admin/plans` | List/create plan and initial immutable version |
| PATCH | `/api/super-admin/plans/:id` | Create a new plan version or change active state |
| GET | `/api/super-admin/subscriptions` | Current subscription inventory |
| PATCH | `/api/super-admin/subscriptions/:id` | Audited plan/cycle/status/limit changes |
| POST | `/api/super-admin/subscriptions/process` | Manually invoke idempotent subscription processing |
| GET, POST | `/api/super-admin/invoices` | List/create SaaS invoices |
| POST | `/api/super-admin/invoices/:id/payments` | Record a manual administrative payment |
| POST | `/api/super-admin/invoices/:id/credit-notes` | Create and apply a credit note |
| PATCH | `/api/super-admin/invoices/:id/status` | Allowed invoice workflow transition |
| GET | `/api/super-admin/payment-proofs` | Verification queue |
| GET | `/api/super-admin/payment-proofs/:id/file` | Authenticated proof stream |
| POST | `/api/super-admin/payment-proofs/:id/under-review` | Claim proof for review |
| POST | `/api/super-admin/payment-proofs/:id/approve` | Atomically approve and apply payment |
| POST | `/api/super-admin/payment-proofs/:id/reject` | Reject; reason required |
| POST | `/api/super-admin/payment-proofs/:id/duplicate` | Flag duplicate; reason required |
| POST | `/api/super-admin/payment-proofs/:id/request-info` | Request more information |
| POST | `/api/super-admin/hospitals/:id/support-access` | Start explicit tenant support session |
| POST | `/api/super-admin/support-access` | Start support session using body hospital ID |
| GET | `/api/super-admin/support-access` | Support session history |
| POST | `/api/super-admin/support-access/:id/end` | End active support session |
| GET | `/api/super-admin/users` | Safe platform/hospital user projections |
| PATCH | `/api/super-admin/users/:id` | Enable/disable and revoke sessions |
| GET, PATCH | `/api/super-admin/support-requests[/:id]` | Queue and update support requests |
| GET | `/api/super-admin/audit-logs` | Audit list, optionally filtered by hospital |
| GET, PATCH | `/api/super-admin/settings` | Non-secret platform/provider display settings |
| GET | `/api/super-admin/safepay-transactions` | Safepay payments and webhook processing events |

The platform audit endpoint is deliberately not a clinical-audit endpoint. It returns an allowlisted projection of platform, subscription, payment, user, and support-access actions; operational patient markers and unrestricted metadata are excluded, and non-public reasons are redacted from the platform view.

The Platform Settings UI distinguishes runtime-backed controls from stored launch-planning values. Invoice prefixes, renewal/reminder timing, and the default support-access duration are consumed by the current runtime. Identity, grace/suspension, notification, and retention values that are not yet wired into enforcement are presented read-only and explicitly labelled as having no runtime effect rather than being shown as active policy.

Onboarding request outline:

```json
{
  "hospital": {
    "name": "Demo General Hospital",
    "code": "demo-general",
    "email": "contact@demo.invalid",
    "phone": "+92-300-0000000",
    "city": "Lahore",
    "province": "Punjab",
    "numberOfBeds": 50,
    "numberOfBranches": 1
  },
  "subscription": {
    "planId": "<plan-id>",
    "billingCycle": "MONTHLY",
    "startDate": "2026-07-13",
    "trialDays": 0,
    "implementationFee": 100000,
    "subscriptionPrice": 75000,
    "discount": 0,
    "taxRate": 0,
    "invoiceDueDays": 7,
    "gracePeriodDays": 7
  },
  "limits": {
    "maxUsers": 10,
    "maxBranches": 1,
    "maxBeds": 50,
    "storageLimitMb": 10240,
    "enabledModules": ["dashboard", "patient_registration", "appointments", "opd_billing", "payments", "receipts"]
  },
  "administrator": {
    "fullName": "Demo Administrator",
    "email": "admin@demo.invalid",
    "mobile": "+92-300-0000000",
    "temporaryPassword": "Temporary@123",
    "roleKey": "hospital_admin",
    "mustChangePassword": true
  }
}
```

`POST /api/hospital/patient-refunds`:

```json
{
  "paymentId": "PAY-9008",
  "amount": 1000,
  "reason": "Duplicate collection corrected after cashier review",
  "method": "Cash"
}
```

`POST /api/hospital/data-export-requests`:

```json
{
  "scope": "BILLING",
  "format": "CSV",
  "reason": "Month-end reconciliation"
}
```

Refund totals cannot exceed the positive source payment. A refund is stored as a negative patient payment, updates the related patient-invoice balance, creates a receipt, and writes an audit record. Export requests create reviewed work items; the demonstration does not silently generate or expose a bulk download.

## Safepay webhook

`POST /api/webhooks/safepay` is public at the network layer and must receive the provider signature in `x-safepay-signature` (the adapter also recognizes `x-sfpy-signature`). The handler verifies the signature over the raw body before storing or processing an event. Provider event IDs and payment references are unique, so delivery retries are idempotent.

A successful production event must match a payment intent created by `POST /api/hospital/subscription-invoices/:id/safepay-link`: tracker, tenant, invoice, outstanding amount, and currency are bound before redirecting to hosted checkout. Completed, ignored, and duplicate events are acknowledged without applying money again. An event recorded as `FAILED` may be retried with the same provider event ID after the underlying payload/integration issue is corrected; only a successful database transaction marks the intent and event complete.

The current adapter is a structural integration boundary, not a merchant-certified implementation. Before enabling it, validate endpoint URLs, signature encoding, payload fields, amount units/currency, event types, retry timing, and reconciliation against the credentials and documentation for the actual Safepay merchant account. A browser return URL never activates a subscription; only a verified `payment.succeeded`-equivalent webhook may do that.

Do not log authorization headers, signatures, raw credentials, card data, reset tokens, or full webhook payloads. Stored webhook payloads are sanitized, but production logging still needs a formal redaction policy.

## State and idempotency expectations

- Payment approval, invoice balance update, subscription reactivation/extension, notification, and audit creation are one transaction.
- A bank transaction reference cannot be approved twice.
- Safepay event IDs and provider references are unique; retries return a successful duplicate acknowledgement.
- Renewal invoices use an idempotency key per subscription and billing-period start.
- Invoice status is derived from payments/credits where appropriate. Clients cannot directly force `PAID` or `PARTIALLY_PAID`.
- `READ_ONLY` and `PAUSED` permit reads/printing/billing but reject operational writes.
- `SUSPENDED` and `CANCELED` permit only designated Hospital Administrator billing/export/support access; other hospital users cannot sign in.
- No subscription transition deletes tenant, patient, invoice, or audit data.

## Before exposing this API externally

Add an `/api/v1` compatibility boundary, OpenAPI schema generated from reviewed contracts, pagination and stable sorting, request IDs, rate limiting, service-to-service authentication, CSRF controls where applicable, stronger password/MFA/session policy, database-backed idempotency keys for all externally retried writes, and centralized audit/observability. See [Cloud deployment and integration guide](./CLOUD-DEPLOYMENT.md).
