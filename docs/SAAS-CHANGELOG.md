# Multi-hospital SaaS extension change record

This project did not include Git metadata when the extension began. The original baseline was therefore audited before editing and major changes are recorded here instead of relying on a Git diff.

## Preserved baseline

- The original hospital interface, sample clinical data, patient billing flow, reports, cards, tables, modals, and light-blue/white visual tokens were preserved in `src/pages/hospital/HospitalPortal.jsx`.
- The original baseline production build passed before SaaS work began.
- Patient invoices remain a separate domain from AI Finora subscription invoices.

## Major files changed

- `src/App.jsx`: replaced the single-area entry with public, hospital, and Super Admin routing.
- `src/main.jsx`: wraps the application with browser routing and authentication context.
- `src/styles.css`: retains the original theme and adds hospital subscription/read-only/support-access states.
- `package.json`: adds one-command client/server development, Prisma, seed, test, and verification scripts.
- `vite.config.js`: adds the local API proxy.
- `README.md`: documents the new architecture and demonstration workflows.
- `server/src/middleware/`: enforces authenticated tenant access, temporary-password completion, safe response projection, upload validation, and consistent errors.
- `server/src/services/`: implements audited onboarding, access/lifecycle state, immutable plan/version billing, invoice/payment transactions, and provider boundaries.
- `server/src/routes/`: exposes public/auth, tenant hospital, Super Admin, proof-file, support-access, and webhook contracts.
- `server/prisma/schema.prisma` and `server/prisma/migrations/`: define tenant-scoped operational and SaaS billing records with checked-in migration history.
- `server/tests/integration.test.js`: covers deterministic seed behavior, authentication/lockout, safe projections, tenant isolation, access states, lifecycle transitions, payment-proof integrity, invoice transitions, plan limits, and Safepay replay/retry controls.
- `eslint.config.js` and `.github/workflows/ci.yml`: add strict linting and repeatable install/generate/lint/test/build verification.
- `Dockerfile`, `docker-compose.yml`, and `deploy/nginx.conf`: add a containerized single-replica demonstration with one-shot migrations, persistent volumes, health checks, SPA serving, and `/api` proxying.
- `.env.example`, `server/scripts/bootstrapDatabase.js`, `start-demo.bat`, and `start-demo.sh`: document configuration and make a clean SQLite start reliable on Windows, macOS, and Linux.
- `docs/API.md` and `docs/CLOUD-DEPLOYMENT.md`: document the implemented contract and the external infrastructure, payment, security, compliance, and operations work required before real deployment.

## Major files moved or added

- The former monolithic `src/App.jsx` hospital demo was moved to `src/pages/hospital/HospitalPortal.jsx` and adapted to authenticated tenant APIs.
- `server/` contains the Express API, Prisma schema/migration, seed data, subscription/payment services, middleware, and tests.
- `src/pages/super-admin/`, `src/components/super-admin/`, `src/pages/auth/`, `src/context/`, `src/services/`, and `src/guards/` contain the new SaaS frontend layers.

Generated output (`dist`), SQLite databases, local uploads, and installed dependencies are intentionally not source artifacts.

## Production-oriented hardening completed

- Sensitive password hashes, reset/lockout internals, token versions, and private file storage metadata are stripped from JSON responses.
- Hospital queries and mutations use the authenticated tenant ID, including new user, branch, inventory, refund, and export workflows.
- Subscription state is enforced by the API; suspended/canceled hospitals retain only designated administrator billing/export/support access and overdue data is never deleted.
- Recurring processing is idempotent, continues to evaluate already-overdue invoices, protects active trials, and advances `PAST_DUE` to `GRACE_PERIOD` and `READ_ONLY`.
- Manual proof resubmissions remain bound to the rejected invoice, proof magic bytes are checked, review actions are state-limited and audited, and payment application is transactional.
- Safepay success requires an invoice-bound intent plus matching tracker, amount, and currency; completed events are idempotent and failed event rows can be safely retried.
- Financial writes use serializable transactions, optimistic state predicates, and bounded conflict retries so concurrent payment, credit, refund, proof, or webhook processing cannot silently apply stale balances.
- Super Admin audit responses use a default-deny platform projection that excludes operational patient audit detail and redacts non-public metadata.
- Production builds force the local demonstration-account picker off and scan the generated bundle for configured demo emails and passwords.
- The hospital Subscription & Billing deep link was browser-tested and its unstable effect dependency was corrected so loading completes after the subscription response updates parent state.
- Hospital page rendering now synchronously gates deep links against effective role/plan/status access, while platform resources and public payment-status lookups cancel or ignore obsolete requests.
- Docker launch notes generate a production-acceptable random JWT secret instead of showing a value that the server intentionally rejects.
- A fail-closed email provider boundary supports disabled or explicitly simulated outcomes, exposes honest health capability flags, and reserves real delivery for a post-commit outbox/worker integration.
- Hospital search covers the advertised hospital and primary-contact fields, and subscription status edits create deduplicated in-app notifications for real transitions.
- Hospital and platform SaaS invoice print views include explicit billing periods, payment instructions, and only allowlisted public bank fields with safe unconfigured/demo notices.

These controls make the repository a stronger deployment baseline, not a healthcare or payment certification. The remaining external launch gate is tracked in `docs/CLOUD-DEPLOYMENT.md`.
