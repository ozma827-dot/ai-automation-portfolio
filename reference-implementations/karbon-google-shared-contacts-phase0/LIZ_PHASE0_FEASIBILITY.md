# Phase-0 feasibility note: Karbon → Google Shared Contacts

**Self-built response to a publicly described integration pattern; not commissioned work. Synthetic data only. No buyer account, records, credentials, or live systems were accessed.**

## 1. What I validated

I implemented and locally ran a bounded reference for the integration's highest-risk seam: signed change events, duplicate handling, identity resolution, Atom/XML contact creation, update version checks, and reconciliation boundaries. See the [source and tests](./).

## 2. What is technically confirmed

- A Karbon webhook is a lightweight change notification; the worker fetches the full contact using `ResourcePermaKey`. The single-event example uses `TimeStamp`; the preview batch envelope uses `Timestamp`.
- Karbon supports an optional raw-body HMAC-SHA256 `Signature`; an endpoint should acknowledge promptly and process asynchronously. Recommended rate is no more than 120 requests/minute, and `429` responses should honor `Retry-After`.
- Google Domain Shared Contacts uses an Atom/XML `POST` create feed and `GData-Version: 3.0`. Updates use the returned versioned edit URL and must preserve the returned XML; a stale edit version must be re-read/reconciled, not blindly overwritten.
- Domain Shared Contacts are external contacts shared with the Workspace domain. They are visible across the domain; this is not an individual's private contact list. The People API directory methods are separate and are not a substitute writer for Domain Shared Contacts.

Sources: [Karbon webhooks](https://developers.karbonhq.com/guides/webhooks/), [Karbon rate limits](https://developers.karbonhq.com/guides/rate-limits/), [Google create](https://developers.google.com/workspace/admin/domain-shared-contacts/create-shared-contacts), [Google update](https://developers.google.com/workspace/admin/domain-shared-contacts/update-delete-shared-contacts), [Google overview](https://developers.google.com/workspace/admin/domain-shared-contacts/overview), [People API](https://developers.google.com/people/api/rest).

## 3. What still requires client-account access

Workspace domain and API enablement; approved OAuth flow/scopes; Karbon application access and webhook subscription; actual contact fields and source of truth; whether organizations or only people are synced; tenant-specific matching rules; deletion/archive policy; expected volume; production queue/storage and monitoring; and an authorized redacted test fixture. No credential should be sent in chat or placed in a public repo.

## 4. Phase-1 candidate architecture

Karbon webhook → verify raw signature → atomically persist/deduplicate event → acknowledge → queue worker → fetch changed record → normalize/validate → match and branch → Google Shared Contacts Atom/XML create or versioned update → audit outcome. A durable inbox/outbox and per-identity serialization are required in production; the demo's in-memory queue is only a local fixture.

## 5. Identity resolution rules

1. Exact Karbon source ID.
2. Normalized email.
3. Valid E.164 phone only when the source includes an explicit country code.

If identifiers resolve to different records, if a key is duplicated, or if required match keys are absent, do not merge automatically: place the record in human review with the conflicting evidence. Never infer a country code.

## 6. Failure and reconciliation design

Use webhook-first change detection, bounded `Retry-After` backoff for Karbon `429`, timeouts with bounded retry for safe reads, and page checkpoints advanced only after each page is fully handled. Reconcile with supported incremental filters/overlap plus periodic full verification; emit created, updated, unchanged, conflict, failed and manual-review counts. Google creates do not take this demo's idempotency key, so an uncertain create must be looked up by the stored source-ID property before retry. Preserve server XML and re-fetch on a stale version.

## 7. Phase-2 feasibility dependencies

RingCentral is not part of this implementation. Before estimating it, confirm the desired object (call metadata, recording, voicemail, SMS/MMS, or AI transcript/summary), account entitlement, exact API scopes, region, retention, user access, and whether the buyer authorizes AI processing. If content is written to Gmail or another searchable store, explicitly decide authorized users, indexing scope, retention and downstream AI/tool access. The separate [RingCentral matrix](./RINGCENTRAL_FEASIBILITY.md) lists current documented boundaries.

## 8. Required buyer inputs

- Redacted Karbon field schema and 5–10 synthetic or approved sample records, including collision cases.
- One authoritative identity key and approved fallback order.
- Google Workspace test domain, admin enablement and OAuth process (entered only in the buyer's secure environment).
- Create/update/delete expectations, domain-wide visibility acceptance, volume and service-level target.
- Acceptance examples for duplicate, changed email, missing field, conflicting identifiers and retry.
- For Phase 2: exact RingCentral data type and destination, region/account feature confirmation, access list and retention decision.

## 9. Security boundaries

Least privilege; separate test from production; keep secrets in an approved runtime secret store; minimize and redact PII; make writes auditable; route uncertain identity to a human; agree retention/deletion; never place tax/accounting/customer data in this public synthetic reference. Domain Shared Contacts are domain-visible, which needs explicit admin/business approval. These are design questions, not a legal or compliance assessment.

## 10. Phase-0 acceptance criteria

The local reference passes when a duplicate signed event queues once; invalid signatures are rejected; the worker fetches by source key; matching order is deterministic; ambiguous/conflicting identities never auto-merge; Atom/XML includes approved mapped fields and the source ID; stale update versions do not overwrite; a failed page can resume without skipping; reconciliation separates conflict and manual review; and all demo HTTP calls remain on loopback. Actual tenant/API access and production deployment are expressly outside this phase-0 reference.
