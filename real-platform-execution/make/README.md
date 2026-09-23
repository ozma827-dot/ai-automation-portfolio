# Make Real-Platform Execution Proof


**Executed on Make. Synthetic test data only. Not client work.**


This documents real scenario-building and Run once activity in the Make platform. Five Run once executions were completed before the persistent Data Store check was added; one successful execution completed after it was added, followed by one replay attempt. That is seven executions across scenario iterations, not seven runs of an identical final configuration.


## What was actually verified


- The scenario's validation/high-priority filter passed for the synthetic input.
- A Make Data Store existence check and Router were configured for new-versus-existing event routing.
- The initial NEW EVENT execution added `make-demo-100` to the `revenue-proof-events` Data Store with overwrite disabled; the store then showed one record (46 bytes of the 1 MB free store).
- A later Run once with the same `event_id` produced one bundle on the `DUPLICATE` route and zero on the `NEW EVENT` route.
- In that replay, the Data Store `Add/replace a record` module also ran and failed with `Duplicate key error`; Make marked the overall execution as Error. Rechecking the Data Store showed one record and no second entry.


The sample output file is a sanitized summary of these Make UI observations, not a raw execution bundle.


## Scenario path


See [scenario-summary.md](scenario-summary.md), [sample-input.json](sample-input.json), and [sample-output.json](sample-output.json).


## Limits


- Persistent cross-run idempotency is **not proven**: although the `DUPLICATE` route ran, the replay was not a successful no-op because `Add/replace a record` failed with a duplicate-key error. No successful replay-safe result is claimed.
- One unused, disconnected Data Store module with an incomplete configuration remained on the canvas; it is outside the verified execution path.
- No screenshot or exported scenario blueprint is included. The current public proof is text plus JSON.
- No client data, credentials, or production account integration was used. This is not client work and does not claim a production deployment.
