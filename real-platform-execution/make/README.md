# Make Real-Platform Execution Proof

**Executed on Make. Synthetic test data only. Not client work.**

This records real scenario-building and Run once activity. Five executions occurred before the Data Store check was added; one successful first-write run followed; then one replay failed before the filter was corrected and one replay succeeded after the correction. That is eight runs across scenario iterations, not eight runs of one unchanged final configuration.

## What was actually verified

- The validation/high-priority filter passed for the synthetic input.
- A Make Data Store existence check and Router separate new events from existing keys.
- The initial NEW EVENT run added make-demo-100 to the revenue-proof-events Data Store with overwrite disabled. The store showed exactly one record (46 bytes of the 1 MB free store).
- On 2026-09-23, the corrected replay used the same event_id. The execution completed with overall status **Success**: 1 bundle followed the DUPLICATE route; the NEW EVENT and STORE NEW EVENT routes each handled 0 bundles; the write module did not execute.
- The Data Store still contained exactly one record, keyed make-demo-100 (46 bytes).

The sample output is a sanitized summary of the Make UI observations, not a raw execution bundle.

## Scenario path

See [scenario-summary.md](scenario-summary.md), [sample-input.json](sample-input.json), and [sample-output.json](sample-output.json).

## Limits

- The corrected replay demonstrates duplicate suppression for this same synthetic event_id in this specific scenario. It is not a concurrency test and does not establish production reliability.
- One unused, disconnected Data Store module with incomplete configuration remained on the canvas; it is outside the verified execution path.
- No screenshot or exported scenario blueprint is included. The public proof is text and JSON.
- No client data, credentials, or production account integration was used. This is not client work and does not claim a production deployment.
