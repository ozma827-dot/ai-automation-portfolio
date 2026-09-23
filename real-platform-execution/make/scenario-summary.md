# Scenario Summary

## Purpose

A small Make scenario exercises input validation, a high-priority branch, and event-key lookup/write behavior using synthetic values.

## Verified path

1. The configured synthetic input used `event_id=make-demo-100`, `email=DEMO@Example.com`, and `priority=high`.
2. The validation and high-priority filter visibly passed in the initial Run once execution.
3. Data Store module 5 checked for the `event_id` key in `revenue-proof-events`.
4. Router module 9 separated:
   - **NEW EVENT** when the key did not exist; the initial successful run reached Data Store module 11 (Add/replace record, overwrite disabled) and created one record.
   - **DUPLICATE** when the key existed; this branch reaches a Tools result labeled `DUPLICATE`.
5. After that successful write, the Data Store page showed one record under key `make-demo-100`.
6. A later Run once with the same input reached the `DUPLICATE` route (one bundle); the `NEW EVENT` route showed zero. However, Data Store module 11 also ran and failed with `Duplicate key error. A record with the same key exists or was already inserted in this scenario.` Make marked the replay execution as Error.
7. Rechecking the Data Store after the failed replay showed one record under `make-demo-100`, with no second entry.

## Evidence boundary

Five Run once executions preceded the Data Store change; one successful run followed it, and one additional replay attempt failed. Thus seven executions occurred across scenario iterations, not seven runs of one unchanged final configuration. The duplicate route did execute, but persistent idempotency/replay safety is **not proven** because the overall replay errored while the Add/replace module attempted a duplicate write. No successful replay-safe no-op is claimed.

The current public evidence is a truthful scenario description and sanitized sample JSON, not a screenshot, export, client deployment, or raw execution bundle.
