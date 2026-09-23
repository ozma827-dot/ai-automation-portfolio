# Karbon → Google Workspace Shared Contacts: Phase-0 Reference

**Self-built technical reference. Synthetic fixtures only. Not client work or a production integration.**

This reference tests the failure-prone core of a contact-sync workflow: signed Karbon webhook intake, duplicate-safe event handling, full-record fetch, deterministic identity matching, Google Domain Shared Contacts Atom/XML payloads, version-aware updates, and reconciliation checkpoints. It makes real HTTP requests only to a local mock server on loopback.

## What it demonstrates

- HMAC-SHA256 verification over the exact raw webhook body before parsing.
- Fast acknowledgement after the queue boundary accepts an event; duplicate delivery suppression and a 25-event burst fixture.
- The webhook is treated as a change notification, not a full contact; the demo fetches the synthetic Contact by `ResourcePermaKey`.
- Karbon ID → normalized email → E.164 phone matching. Duplicate or conflicting identifiers go to human review; no automatic merge.
- Bounded Karbon `429` / `Retry-After` backoff, deferral when the requested wait exceeds the inline-worker budget, timeout retry, and page-level checkpoint/restart behavior.
- Google Domain Shared Contacts XML create representation for name, email, phone, address, and a Karbon ID extended property.
- Versioned edit-URL checks, preservation of server-returned XML, and explicit stale-version `409` handling.
- A synthetic replay-safe writer test for a lost response after commit. It proves one logical write in the local model only; it does not claim the Google API accepts an idempotency key.
- Reconciliation totals for created, updated, unchanged, conflict, failed, and manual review.

The official Karbon single-event example spells the timestamp `TimeStamp`; its preview batch example uses `Timestamp`. The parser accepts both documented spellings. Karbon recommends staying at or below 120 requests/minute, honoring `Retry-After` on `429`, and preferring webhooks to frequent polling ([webhooks](https://developers.karbonhq.com/guides/webhooks/), [rate limits](https://developers.karbonhq.com/guides/rate-limits/)).

## Run

Requirements: Node.js 20+; no third-party package install, account, OAuth consent, API key, or network access is required.

```bash
node reference-implementations/karbon-google-shared-contacts-phase0/demo.mjs
npm test
```

The demo starts a temporary HTTP server bound to `127.0.0.1`, posts the same synthetic webhook twice, fetches a fake Karbon contact, and sends an Atom/XML create request to a local Google-shaped mock endpoint. It closes the server before exit. Expected output is in [`demo/sample-output.json`](demo/sample-output.json); the synthetic input is in [`demo/sample-input.json`](demo/sample-input.json).

## Architecture

```text
Karbon event (lightweight notification)
        │ raw-body HMAC check
        ▼
Fast 2xx after durable enqueue ── production requires a persistent, atomic inbox
        │
        ▼
Async worker → fetch Contact by ResourcePermaKey → normalize fields
        │
        ▼
Match Karbon ID → email → E.164 phone
        ├── conflicting / duplicate / ambiguous → human-review queue
        ├── no target → build Atom/XML → Domain Shared Contacts create
        └── matched target → fetch latest entry → preserve XML → versioned PUT
        │
        ▼
Audit outcome + delta checkpoint + periodic reconciliation
```

## Important API boundary

Google Domain Shared Contacts is a separate Workspace API using Atom/XML requests (including `GData-Version: 3.0`); a create is a `POST` to the domain feed. Updates must preserve the server-returned XML and use its versioned edit URL; stale versions must be re-fetched/reconciled rather than blindly overwritten. This API is for external contacts, and shared entries are visible to all users and Google services in the domain. It requires Workspace enablement and changes can take up to 24 hours to surface. The People API's directory/list operations are not a substitute writer for Domain Shared Contacts. See Google's [create guide](https://developers.google.com/workspace/admin/domain-shared-contacts/create-shared-contacts), [update guide](https://developers.google.com/workspace/admin/domain-shared-contacts/update-delete-shared-contacts), [API overview](https://developers.google.com/workspace/admin/domain-shared-contacts/overview), and [People API](https://developers.google.com/people/api/rest).

## Reconciliation and production deltas

The included checkpoint helper advances only after an entire page is applied. It is an adapter seam, not a claim that either provider exposes the same cursor. Karbon change detection should be webhook-led, with bounded recovery reads. For a `429`, the demo honors short `Retry-After` values and defers unusually long waits to a durable scheduler rather than holding a worker open. Google Domain Shared Contacts uses its own feed/query semantics; its `start-index` is not a durable stable cursor. A production sync should use supported updated-time filtering where available, overlap/replay safely, persist checkpoints, and periodically run a full comparison. A scheduled reconciliation report is a repair mechanism, not an hourly unbounded full scan.

Google's API itself does not accept this demo's idempotency key. For an uncertain create response, production must persist the source ID, query/reconcile for that ID before replay, and serialize writes per identity; it must not blindly repeat a POST. The in-memory inbox, queue, writer, and local mock are test fixtures—not durable production components.

## Security and privacy

- Use least-privilege OAuth and separate test and production credentials/environments.
- Never put credentials in workflow exports, source control, logs, or screenshots; inject secrets at runtime and redact them from errors.
- Minimize mapped personal information. Route missing/ambiguous identifiers and destructive changes to a human.
- Keep an auditable source-event ID, decision, result, and retry outcome without copying unnecessary PII into logs.
- Agree retention and deletion behavior before storing contact data, transcripts, or attachments.
- Do not use client tax, accounting, or personal data in this demo. All names, addresses, keys, and emails use synthetic/example values.
- Shared Contacts are visible domain-wide. Confirm domain-wide visibility, authorized users, ownership, and retention with the Workspace administrator before creating any real entry.
- This repository includes no secrets and makes no live Karbon, Google, Make, n8n, RingCentral, Gmail, or production-account calls.

## Limitations and acceptance checks

This is a bounded protocol/reference implementation, not a complete Google Data API client or production-ready XML parser. The XML helper deliberately handles the checked-in Atom fixtures only; production must use a hardened standards-compliant parser with secure entity settings. The local queue is in-memory and its `202` is not durable across process failure. OAuth authorization, Workspace admin enablement, tenant-specific fields, deleted-contact semantics, update mappings, durable locking, monitoring, deployment/rollback, and live provider behavior require an authorized buyer-owned test account and agreed scope.

Phase-0 acceptance checks: duplicate event produces one queued work item; event signature is validated before use; the worker fetches by source key; conflicting/ambiguous identity never auto-merges; Atom payload round-trips through the local HTTP mock; stale edit versions do not call PUT; checkpoint does not skip a failed page; reconciliation separates conflicts from manual review; no outbound call escapes loopback.

## Source links

- [Karbon Webhooks](https://developers.karbonhq.com/guides/webhooks/)
- [Karbon rate limits](https://developers.karbonhq.com/guides/rate-limits/)
- [Google Shared Contacts create](https://developers.google.com/workspace/admin/domain-shared-contacts/create-shared-contacts)
- [Google Shared Contacts update/delete](https://developers.google.com/workspace/admin/domain-shared-contacts/update-delete-shared-contacts)
- [Google Domain Shared Contacts overview](https://developers.google.com/workspace/admin/domain-shared-contacts/overview)
- [Google People API](https://developers.google.com/people/api/rest)
