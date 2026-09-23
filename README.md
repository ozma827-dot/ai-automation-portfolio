# AI Automation Portfolio

Project-based automation and workflow engineering focused on validation, deterministic processing, exception handling, traceability and reliable handoff.

Owner identity: WEN JING

## Featured Capabilities

- Deterministic validation, normalization, deduplication, conflict detection and human-review routing.
- HTTP webhook boundaries, replay-safe processing, bounded retries, audit events and tested failure recovery.
- Enterprise contact-sync reference: signed webhook intake, identity resolution, Atom/XML mapping, version-aware updates and reconciliation.

## Featured Demo

This credential-free Synthetic AI Automation Demo processes lead-like records from a JSON webhook fixture. It demonstrates:

- required-field validation;
- data normalization;
- duplicate suppression;
- changed-record conflict detection through deterministic duplicate handling;
- task/source isolation at the input boundary;
- exception routing to structured rejection or human review;
- replay-safe behavior for duplicate inputs;
- deterministic JSON output;
- bounded retry handling;
- automated tests.

The verified test command currently passes **55 automated tests / 55 executed** (26 lead-routing tests, 9 HTTP reliability tests, and 20 enterprise-integration reference tests).

## Reference Implementation — Webhook-to-Ledger Reliability

The [Webhook → Ledger Reliability Reference](reference-implementations/webhook-ledger-reliability/README.md) exercises an actual HTTP boundary using two local Node.js servers. It demonstrates input validation, stable idempotency, payload-conflict detection, bounded retries, human-review routing and sanitized audit events.

Its key failure test simulates a ledger write succeeding before the response is lost: the retry uses the same idempotency key and creates exactly one record. It is synthetic and local only—not a QuickBooks/Katana, Make, n8n or production integration, and not a client case study.

## Enterprise Integration References

- [Karbon → Google Workspace Shared Contacts Phase-0 Reference](reference-implementations/karbon-google-shared-contacts-phase0/README.md) — self-built technical reference with synthetic fixtures, local HTTP execution and tests; **not client work**.
- [RingCentral feasibility matrix](reference-implementations/karbon-google-shared-contacts-phase0/RINGCENTRAL_FEASIBILITY.md) — official-docs-only access and dependency review; **no RingCentral account or live integration**.
- [Phase-0 technical note](reference-implementations/karbon-google-shared-contacts-phase0/LIZ_PHASE0_FEASIBILITY.md) — public-scope-derived, synthetic feasibility and acceptance criteria; not a quote or commissioned deliverable.

## Real Client Work

No client case study is claimed in this repository. This section can be updated only after real delivery, acceptance and permission to publish.

## Testing & Reliability

Run `npm test` for the complete suite. The enterprise reference also runs end-to-end against a temporary loopback HTTP mock with `npm run karbon-google-demo`; it makes no external provider calls.

## Security & Boundaries

Use data minimization, least privilege, secret injection outside source control, redacted audit events, human review for ambiguous identity, and separate test/production environments. No client tax/accounting data, customer PII or credentials appear in the examples. Google Domain Shared Contacts are visible domain-wide; confirm access and retention with the Workspace administrator. None of the references claims a production deployment.

## Contact / Availability

WEN JING — available for scoped project-based automation work. Please use the public GitHub profile's contact route.

## Authenticity boundary

**Synthetic technical demonstration. Not a client case study.**

This repository makes no claim of production deployment, customer results, revenue, prior employment, education, or client work. The examples use synthetic fixtures; local HTTP demos never call external providers. No client tax/accounting data or credentials are present. Real integrations would require buyer-authorized access, an agreed schema, acceptance tests, and funded scope.


## Real Platform Execution

- [Make scenario execution proof](real-platform-execution/make/) — executed on Make with synthetic data; not client work. In the corrected replay, the duplicate route handled 1 bundle, new-event and store-write routes handled 0, execution succeeded, and the Data Store remained at 1 record. This documents only the tested synthetic scenario, not production or concurrency guarantees.