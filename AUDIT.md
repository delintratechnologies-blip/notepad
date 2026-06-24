# CastReach — Comprehensive Production-Readiness Audit

**Scope reviewed:** Full backend (`server/`) + frontend (`src/`) — every route, model, service, middleware, and user journey.
**Date:** 2026-06-19
**Verdict:** A well-structured **prototype / demo**, not production-ready. The scaffolding (auth, security headers, validation, escrow design) is genuinely good. But **the three revenue-and-trust-critical workflows — payment, session completion, and reputation — are not actually wired together**. Several are silently broken at runtime, not merely incomplete.

---

## 1. Executive Summary

| Dimension | Rating | Notes |
|---|---|---|
| Architecture & code quality | Good | Clean separation, small files, consistent patterns |
| Security baseline | Fair | Strong primitives, but real holes (PII exposure, broken admin gate, token in localStorage) |
| Workflow completeness | Poor | Core money/completion/rating loops are disconnected or unreachable |
| Data integrity | Poor | Race conditions, no transactions, availability not linked to bookings |
| Observability / audit | Missing | `console.log` only; no audit trail despite financial actions |
| Testing | None | Zero application tests (Jest configured, never used) |

**Top 5 production blockers:**
1. ~~**Bookings can never reach `completed`**~~ — **FIXED** (see "Remediation log"). (BLK-1)
2. **Payment hold is never triggered** — **BACKEND FIXED; frontend Stripe Elements card UI remains** (see "Remediation log"). (BLK-2)
3. ~~**Admin/moderation is dead code**~~ — **FIXED** (see "Remediation log"). (BLK-3)
4. ~~**Reputation aggregates (`avgRating`, etc.) are never computed**~~ — **FIXED** (see "Remediation log"). (BLK-4)
5. ~~**User PII (emails) is publicly enumerable**~~ — **FIXED** (see "Remediation log"). (BLK-5)

> **Remediation log (2026-06-19)** — BLK-1 and BLK-4 resolved:
> - **BLK-1:** Daily.co recording handling moved out of the Stripe webhook into a dedicated, signature-verifiable route `routes/webhooksDaily.js` (mounted at `/api/webhooks/daily`). Added a shared `services/bookingLifecycle.completeBooking()` that releases escrow (if held) and notifies both parties, plus a manual `PATCH /api/bookings/:id/complete` endpoint and a "Mark Session Complete" button in `BookingDetail.jsx`. Sessions can now reach `completed`, unblocking reviews/payment release/badges. Removed dead `createPaymentIntent` import (DEAD-1).
> - **BLK-4:** Added `services/reviews.recomputeUserRating()`, invoked on review submission before the badge check, so `avgRating`/`totalReviews` reflect reviews received. Added `ReviewSchema` Zod validation on the review endpoint (VAL-1).
>
> **Remediation log (2026-06-20)** — BLK-3, BLK-5, and BLK-2 (backend) resolved:
> - **BLK-3:** Access JWT now carries `role` (`routes/auth.js`). `moderation.isAdmin` re-reads role + `isBlocked` from the DB authoritatively (demoted/blocked admins lose access immediately). Added `scripts/createAdmin.js` as the admin-provisioning path (no self-serve route).
> - **BLK-5:** `GET /api/users` and `GET /api/users/:id` now require auth and use a public projection that strips `email` (and `__v`); a user still sees their own email on their own record and via `/auth/me`. Also hardened `page`/`limit` parsing (VAL-4).
> - **BLK-2 (backend):** Added `User.sessionRateCents` (host's price). Booking creation now snapshots `amountCents` from the host's rate, rejects self-booking (EDGE-2), validates host role/existence, and rejects past/ill-formed slots (EDGE-3/4). `services/stripe.createEscrowIntent` now takes a platform fee via `application_fee_amount` (`PLATFORM_FEE_BPS`, default 15%). `payments/intent` charges the real booking amount, requires a confirmed booking, and no longer marks `held` optimistically — the hold is confirmed via the `payment_intent.amount_capturable_updated` webhook. Recording-room creation is gated on `paymentStatus==='held'` for paid sessions (HTTP 402).
> - **BLK-2 remaining:** the frontend card-collection step (Stripe Elements + `@stripe/react-stripe-js`, publishable key, confirm `clientSecret`). Backend is ready to receive it.
>
> **Remediation log (2026-06-22)** — first test coverage (G14, partial):
> - Split `index.js` into `app.js` (importable Express app, no DB connect / no `listen`) + `index.js` (connect + listen), so the app can be tested in isolation.
> - Added a Jest + Supertest + `mongodb-memory-server` harness (`jest.config.js`, `tests/setup.js`, `tests/helpers.js`). Rate limiters skip in `NODE_ENV=test`; the ESM-only `file-type` package is stubbed via `moduleNameMapper`. External services (Daily, Stripe) are mocked.
> - **23 tests, all passing**, covering the fixed paths: auth + JWT role (BLK-3), PII projection on `/users` (BLK-5), booking validation/pricing/self-booking/overlap (BLK-2, EDGE-2/3/4), the full confirm→complete→review→rating loop (BLK-1, BLK-4), review validation (VAL-1), admin moderation gate + blocked-login (BLK-3), and the paid-session recording gate (402) + free-session payment rejection (BLK-2).
> - Still open (P1): RACE-1 (booking transaction/unique guard), refund on cancel (G7/DEAD-2), dispute workflow (G8), report persistence (G10), audit log (G13), broader test coverage (messages, availability, analytics, webhooks).

---

## 2. End-to-End Workflow Audit

### 2.1 The "happy path" as designed vs. as built

Intended: `Register -> Onboard -> Set availability -> Discover/match -> Request booking -> Host confirms -> Pay (escrow hold) -> Record -> Recording completes -> Escrow released -> Both review -> Badges update`.

**Where it actually breaks:**

| Stage | Status | Evidence |
|---|---|---|
| Register / login / refresh | Works | `routes/auth.js` — solid, with refresh-token reuse detection |
| Set availability | Orphaned | `routes/availability.js` stores slots but **booking creation never reads them, never validates against them, never sets `isBooked`** |
| Create booking | Racy | `routes/bookings.js` check-then-create overlap test (see RACE-1) |
| Pay / escrow hold | Never called | `/payments/intent` exists but **no frontend code calls it**; only `/payments/connect` is used (`Settings.jsx:222`) |
| Host confirms | Works | creates Daily room, notifies guest |
| Recording | UI works | `RecordingRoom.jsx` embeds Daily iframe |
| Recording completes -> release escrow -> mark completed | **Unreachable** | The `recording.completed` handler lives **inside the Stripe webhook** (`routes/webhooks.js`), behind `stripe.webhooks.constructEvent`. A Daily.co webhook has no valid Stripe signature -> throws -> 400. The case never runs. |
| Review | Blocked | `POST /:id/review` requires `status === 'completed'`, which is never reached -> **reviews are impossible** |
| Badges / rating | Blocked | Triggered only from review submission, which can't happen; and even if it did, aggregates aren't recomputed |

**Net:** The system can take a booking from `pending -> confirmed` and host a video call, but **cannot complete, charge, release funds, or build reputation.** The entire post-call value loop is dead.

### 2.2 Dead ends & broken connections (concrete)

- **DEAD-1:** `createPaymentIntent` imported in `bookings.js:6` but never used (dead import; the real function is `createEscrowIntent`).
- **DEAD-2:** `refundPayment()` in `services/stripe.js` is never called anywhere — cancellation does **not** refund a held payment.
- **DEAD-3:** `disputed` status exists in the enum but nothing ever sets it; no dispute workflow.
- **DEAD-4:** `moderation/report` only `console.log`s — no `Report` collection, no admin surfacing.
- **DEAD-5:** `GET /api/users?q=` uses `$text` search but **no text index is defined** on the User schema -> search returns nothing (or errors).
- **DEAD-6:** Two divergent Daily-room creators (`routes/recordings.js` inline + `services/daily.js`) with different expiry logic.

---

## 3. Edge-Case Register

### Critical / data-integrity
- **RACE-1 (double-booking):** Booking creation does `findOne(conflict)` then `create()` — two concurrent requests both pass the check and both insert. No unique constraint, no transaction. Indexes exist but aren't `unique`.
- **RACE-2 (availability vs. booking):** A slot can be booked while simultaneously deleted via `DELETE /availability/:id` (they're unlinked systems).
- **EDGE-1:** Guest can book a host whose requested slot isn't in the host's published availability (never validated).
- **EDGE-2:** A user can book **themselves** (no `host !== guest` check).
- **EDGE-3:** `slotEnd <= slotStart` accepted (Zod validates ISO format only, not ordering; no min duration / future-date check).
- **EDGE-4:** Booking in the past is allowed.
- **EDGE-5:** Webhook **idempotency** absent — Stripe retries reprocess events (double capture risk).
- **EDGE-6:** Cancellation after payment is held -> no refund, funds stranded (ties to DEAD-2).
- **EDGE-7:** Both parties can confirm/cancel concurrently -> last-write-wins on status with no optimistic locking.

### Permission / auth
- **PERM-1 (BLK-3):** `req.user` = `{ id }` only (token signed with `{ id }` in `auth.js`). `moderation.js` checks `req.user.role` -> always undefined -> **all admin endpoints 403**. No admin can ever be created or act.
- **PERM-2 (BLK-5):** `GET /api/users` and `GET /api/users/:id` are **unauthenticated** and return email addresses (model `toJSON` strips password/refresh/stripe but **not email**). Full PII harvesting + user enumeration.
- **PERM-3:** No role gate on who can be a "host" being paid — Connect onboarding open to any role.
- **PERM-4:** Review allows host to review guest and vice-versa, but writes to swapped fields (`isGuest -> hostReview`) — works, but no guard against re-reviewing/overwriting.

### Validation gaps
- **VAL-1:** `POST /:id/review` body (`rating`, `comment`) is **not Zod-validated** — `rating` can be missing, 0, 99, or a string; only model min/max 1–5 catches some cases, and a missing rating silently saves a partial subdoc.
- **VAL-2:** `PATCH /users/me` accepts `socialLinks`/`expertise` with no shape/length validation (stored-XSS vector when rendered).
- **VAL-3:** AI endpoints (`/ai/suggest`, `/ai/bio-polish`) take free-form `hostBio/guestBio` and interpolate into the prompt -> **prompt-injection**; `JSON.parse(model output)` returns 500 instead of graceful degrade on parse failure.
- **VAL-4:** `page`/`limit` query params unvalidated (negative/huge values; `limit` capped at 50 but `page` not).

### Failure / recovery
- **FAIL-1:** `notify()` swallows errors silently — a failed notification is invisible.
- **FAIL-2:** No startup validation of required env (`JWT_SECRET`, `STRIPE_*`) — server boots with insecure/empty secrets.
- **FAIL-3:** Mongo connection has no retry/backoff; `process.exit(1)` on first failure.
- **FAIL-4:** No graceful shutdown (in-flight requests dropped).
- **FAIL-5:** Daily room creation failure during confirm leaves booking in a half-confirmed state; partial failures aren't compensated.

---

## 4. Functional Gap Analysis

| # | Gap | Why it matters | Business impact | Recommended fix | Priority |
|---|---|---|---|---|---|
| G1 | No completion trigger | Whole post-session loop dead | No revenue, no reviews | Register a **separate** authenticated Daily webhook route (signature-verified) OR a "mark session ended" action; move `recording.completed` out of the Stripe handler | P0 |
| G2 | No pricing model | Escrow has nothing to charge | Platform earns $0 | Add host rate (`User.sessionRateCents`), set `Booking.amountCents` at creation, take platform fee (`application_fee_amount`) | P0 |
| G3 | Payment never initiated | Confirm doesn't require payment | Sessions happen unpaid | Trigger `/payments/intent` in confirm/booking flow; gate room access on `paymentStatus==='held'` | P0 |
| G4 | Rating aggregation missing | Trust signals are zeros | Discovery/matchmaking useless | On review save, recompute `avgRating`/`totalReviews` (and response-time on confirm) | P0 |
| G5 | Admin role not in token | Moderation unusable | Cannot police abuse | Add `role` to JWT payload; re-fetch role server-side for sensitive ops | P0 |
| G6 | Public PII exposure | Emails harvestable | Compliance/privacy breach | Require auth on `/users`; strip `email` from public projection | P0 |
| G7 | Refund/cancel policy | No refunds, no cancellation window | Disputes, chargebacks | Implement refund on cancel + cancellation-window rules | P1 |
| G8 | Dispute workflow | `disputed` unused | No recourse mechanism | Build dispute open/resolve + admin queue | P1 |
| G9 | Availability <-> booking link | Slots orphaned | Double bookings, confusion | Validate booking against availability; mark `isBooked` transactionally | P1 |
| G10 | Report persistence | Reports vanish | Safety/legal | `Report` collection + admin review UI | P1 |
| G11 | Email/push delivery | Notifications DB-only | Low engagement, missed sessions | Email (e.g. Resend/SES) + later web-push; session reminders | P1 |
| G12 | Search index | `$text` no index | Discovery broken | Add text index or Atlas Search | P1 |
| G13 | No audit trail | Financial actions untracked | Forensics/compliance | `AuditLog` collection (see section 6) | P1 |
| G14 | No tests | Regressions invisible | Fragile releases | Integration tests on auth/booking/payment/webhook | P1 |

---

## 5. Risk Register

**Business risks**
- **BR-1:** Unpaid sessions / no platform fee -> no viable revenue (G2, G3).
- **BR-2:** Stranded escrow funds on cancel -> chargebacks, support load, trust loss (DEAD-2).
- **BR-3:** No reputation = no marketplace liquidity; Discover ranks everyone at rating 0 (G4).
- **BR-4:** Email enumeration -> spam/phishing of your user base, GDPR/CCPA exposure (G6).
- **BR-5:** No moderation capability -> cannot remove bad actors (G5, G10).

**Technical risks**
- **TR-1:** Webhook misrouting (Daily inside Stripe handler) -> completion never fires (BLK-1).
- **TR-2:** Double-booking race -> overlapping sessions, refund disputes (RACE-1).
- **TR-3:** No idempotency -> duplicate captures on Stripe retries (EDGE-5).
- **TR-4:** Access token in `localStorage` -> XSS token theft (refresh cookie is correctly httpOnly).
- **TR-5:** No env validation -> production can run with empty `JWT_SECRET` (FAIL-2).
- **TR-6:** No observability -> outages and money bugs are invisible until users complain.

---

## 6. Audit Trail & Traceability (currently: none)

There is **no audit logging** despite money movement, account suspension, and reviews. Recommend an immutable `AuditLog` collection capturing actor, action, target, before/after, IP, and timestamp for:

| Event class | Examples | Suggested retention |
|---|---|---|
| Auth/security | login success/fail, refresh-reuse detection, logout, password change | 1 yr (security events 2 yr) |
| Financial | intent created, escrow held/released/refunded, Connect onboarding | 7 yr (financial/tax) |
| Booking lifecycle | created/confirmed/cancelled/completed/disputed, with actor | 2 yr |
| Moderation | report filed, block/unblock, with reason | indefinite (legal) |
| Reviews | submitted/edited (change history) | life of account |
| Profile | PII/profile edits (change history) | 1 yr |

Also add structured request logging (pino/winston + request IDs) and error monitoring (Sentry).

---

## 7. Improvement Opportunities

**Short-term (productize the MVP)**
- Replace polling (`useRealtimeMessages` 5s, notifications 15s) with WebSocket/SSE — current approach won't scale and lags chat.
- Add booking reminders (24h/1h) and a "session ended" confirmation screen.
- Idempotency keys on payment ops; webhook event dedup table.
- Per-endpoint rate limits (the AI route currently shares the *auth* limiter; global 100/15min is too tight for a real app).
- Optimistic concurrency (`version`/status guards) on booking transitions.

**Long-term**
- Calendar sync (Google/Outlook/ICS) so availability isn't manual.
- AI: episode-prep packs, auto show-notes/transcription from recordings, auto-clip generation, semantic matchmaking via embeddings (current matchmaking is exact-string overlap on `expertise`).
- Payout dashboard, invoices/receipts, multi-currency, tax handling.
- Trust & safety: identity verification, content moderation on bios/messages, ratings dispute flow.
- Analytics: host earnings, funnel/conversion, no-show tracking.
- Accessibility pass (inline styles, no semantic structure, no keyboard/ARIA) and mobile responsiveness audit.

---

## 8. Technical Architecture Notes

- **DB design:** Reasonable, but missing: `unique` overlap protection, availability<->booking FK linkage, User text index, pricing fields, denormalized counters maintained transactionally. Reviews stored on Booking but never propagated to User.
- **State management (frontend):** Hand-rolled fetch + context is fine for this size; consider React Query for caching/retries/dedup. Auth uses `localStorage` token (see TR-4).
- **Error handling:** Central handler present, but routes mostly leak `err.message` to clients (info disclosure) and return 500 for client errors.
- **Scalability:** Polling + in-memory rate limiter (won't work across multiple instances — needs Redis store). No caching layer. Daily/Stripe/Anthropic calls are synchronous in the request path (should be queued/retried).
- **Config/secrets:** `.env.example` good; no runtime schema validation of env. Confirm `server/.env` was never committed historically (gitignored now).

---

## 9. Testing & QA Checklist (none exists today)

- **Unit:** matchmaking scoring, badge rules, escrow amount/fee math, date/overlap logic.
- **Integration (priority):** register/login/refresh/reuse-detection; booking create->confirm->complete; payment intent->webhook->release; webhook signature rejection & idempotency; RBAC (admin gate); PII projection on `/users`.
- **Role/permission:** guest vs host vs admin vs non-participant on every booking/message/recording route.
- **Edge:** double-booking concurrency, self-booking, past/invalid slots, missing rating, refund on cancel.
- **Security:** authz bypass, PII leak, prompt injection on AI routes, rate-limit enforcement, file-upload MIME spoofing (the magic-byte check is good — test it).
- **E2E:** full booking journey incl. Daily room; mobile viewport; a11y smoke.
- **Regression:** webhook handlers, payment state machine.

---

## 10. Open Questions (decisions needed before "done")

**Payments & money**
1. Who sets the price — host fixed rate, per-booking negotiation, or free platform? What's the **platform fee %**?
2. When is the guest charged — at request, at host confirm, or at session start?
3. Refund policy: full/partial, cancellation window, who bears Stripe fees?
4. What triggers escrow **release** — recording complete, session end, a confirmation window, or manual?
5. How are disputes resolved and who arbitrates?

**Bookings & availability**
6. Must a booking match published availability, or can guests propose arbitrary times?
7. Can a host have overlapping confirmed sessions? Reschedule flow?
8. No-show handling and penalties?

**Reputation & moderation**
9. Are reviews editable/removable? One-way or mutual-reveal (blind until both submit)?
10. How is the **first admin** created? Self-serve report -> what SLA/queue?
11. Can blocked users keep existing confirmed bookings/funds?

**Platform/ops**
12. Notifications: which are mandatory (email) vs in-app only? Reminder cadence?
13. Real-time: acceptable to keep polling for v1, or move to WebSocket now?
14. Data retention/PII deletion (right-to-erasure) policy?
15. Is `admin` a third role or a flag on host/guest?

---

## 11. Prioritized Action Plan

**P0 — Unblock the core loop (do first):**
1. Move Daily completion out of the Stripe webhook -> dedicated signature-verified route (or explicit "end session" action). (BLK-1/G1)
2. Add pricing fields + set `amountCents`; trigger escrow hold; gate recording on `held`; take platform fee. (BLK-2/G2/G3)
3. Recompute User rating aggregates on review. (BLK-4/G4)
4. Put `role` in JWT; fix admin gate; create-admin path. (BLK-3/G5)
5. Authenticate `/users`; strip `email` from public output. (BLK-5/G6)

**P1 — Integrity, safety, trust:**
6. Booking transaction + unique overlap guard + availability linkage. (RACE-1/G9)
7. Refund on cancel + cancellation policy. (G7)
8. Webhook idempotency + dispute workflow + report persistence. (EDGE-5/G8/G10)
9. Validate review/profile inputs (Zod); audit-log collection. (VAL-1/2/G13)
10. Integration test suite for the flows above. (G14)

**P2 — Scale & delight:**
11. WebSocket realtime, email/reminders, Redis rate-limit store, env validation, monitoring, search index, calendar sync, AI prep/show-notes.

---

*Grounded entirely in the current codebase (file/line references above), not assumptions. The security primitives and code organization are above average for a prototype; most fixes are "connect what's already half-built," not "rewrite." The hard truth: as it stands the app cannot complete a paid session or build reputation, so it is not yet a functioning marketplace.*
