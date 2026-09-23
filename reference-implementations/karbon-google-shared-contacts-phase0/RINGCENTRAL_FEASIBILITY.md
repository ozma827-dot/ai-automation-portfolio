# RingCentral feasibility matrix — Phase 2 boundary

**Documentation review only. No RingCentral account, tenant, credentials, API calls, or integration is present in this repository.** Findings are based on RingCentral's public developer documentation reviewed 2026-09-23; confirm availability, permissions, retention and region in the buyer's own account before quoting implementation.

| Data requested | Official product/API boundary | Access / dependency to confirm | Safe initial treatment |
|---|---|---|---|
| Call metadata | RingCentral Call Log APIs expose call records and metadata. | `ReadCallLog`; account-vs-extension scope and app permissions. | Pull only fields needed to associate a call with a contact. |
| Recording metadata / audio | Call recording metadata and recording content are distinct resources. | Metadata requires `ReadCallLog` and `ReadCallRecording`; content requires `ReadCallRecording`; recording must exist and be available to the authorized user. | Avoid downloading audio unless the buyer explicitly needs it and approves retention/access. |
| SMS / MMS | Communications Data APIs describe SMS/MMS and message status. | Exact read/send endpoints, `SMS`/message permissions, number configuration, account plan, opt-in and data-handling policy. | Treat message bodies as sensitive content; start with metadata only if sufficient. |
| Voicemail / transcription | Data API lists voicemail recordings and voicemail transcription where available on the account. | Availability, account feature, endpoint and permission need tenant validation. | Do not assume transcription exists; validate a buyer-owned test sample. |
| AI transcript, summary, action items | RingCentral AI Conversation Expert (RingSense) API is listed as beta and an add-on; docs list U.S., Canada, Europe and Australia. It provides generated transcriptions, summaries and action items. | Account entitlement, add-on, region, scopes, feature enablement, latency and data policy. Availability in a buyer's country/account cannot be inferred from the public page. | Do not use this path until the buyer confirms eligibility and explicitly approves AI processing. |
| Gmail / searchable records | A separate Google integration and customer-defined destination—not a RingCentral API guarantee. | OAuth scopes, target mailbox/users, message/attachment policy, indexing scope and access model. | Store only the minimum approved summary/metadata; do not ingest complete transcripts by default. |
| Karbon timeline / notes | A separate Karbon write path, not implied by RingCentral access. | Karbon API resource/write support, mapping, audit semantics and customer approval. | Validate the target resource and a reversible test before enabling writes. |

## Candidate flow (not deployed)

```text
RingCentral event or approved data read
  → allowlist required fields and minimize content
  → normalize timestamp, direction, participants, phone, and stable source IDs
  → match to contact (Karbon ID / verified email / normalized phone)
  → conflict or uncertain match → human review
  → write only buyer-approved summary/metadata to the selected destination
  → record source ID, decision, status, retention/deletion state, and errors
  → retry idempotently where the target supports it; reconcile uncertain writes
```

Before implementation, the buyer must decide whether they want call metadata, recording links, voicemail transcription, SMS content, or RingSense-generated output; whether the intended target is Google Shared Contacts, Gmail, or a Karbon timeline; which users and AI tools can access it; and how long each record is retained. A complete transcript copied to Gmail and indexed by other tools is not a default-safe behavior. No compliance conclusion is made here.

## Documentation

- [RingCentral Communications Data APIs](https://developers.ringcentral.com/data-api)
- [Call Log access control and scopes](https://developers.ringcentral.com/guide/voice/call-log/access)
- [RingSense / AI Conversation Expert API](https://developers.ringcentral.com/ringsense-api)
- [RingCentral application permissions](https://developers.ringcentral.com/guide/basics/permissions)
