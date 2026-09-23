# Scenario Summary

## Purpose

A small Make scenario exercises input validation, a high-priority branch, and event-key lookup/write behavior using synthetic values.

## Verified path

1. The configured synthetic input used `event_id=make-demo-100`, `email=DEMO@Example.com`, and `priority=high`.
2. The validation and high-priority filter visibly passed in the Run once execution.
3. Data Store module 5 checked for the `event_id` key in `revenue-proof-events`.
4. Router module 9 separated:
   - **NEW EVENT** when the key did not exist; this branch reached Data Store module 11 (Add/replace record, overwrite disabled) and the accepted output.
   - **DUPLICATE** when the key existed; this branch reached a Tools result labeled `DUPLICATE`.
5. One run after wiring the Data Store path completed. The Data Store page showed a single record under key `make-demo-100`.

## Evidence boundary

Five Run once executions preceded the Data Store change; the later successful run was an additional execution. The duplicate route was configured but the same event was not replayed after the write. Therefore persistent deduplication, replay safety, and duplicate-route runtime behavior remain unverified.

The current public evidence is a truthful scenario description and sanitized sample JSON, not a screenshot, export, client deployment, or raw execution bundle.
