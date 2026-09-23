# Scenario Summary

## Purpose

A small Make scenario exercises input validation, high-priority routing, and cross-run event-key lookup using synthetic values.

## Verified path

1. The configured synthetic input used event_id=make-demo-100, email=DEMO@Example.com, and priority=high.
2. The validation and high-priority filter visibly passed in the first-write Run once execution.
3. Data Store module 5 checked for the event_id key in revenue-proof-events.
4. Router module 9 separated:
   - NEW EVENT when the key did not exist; the first successful run reached Data Store module 11 (Add/replace record, overwrite disabled) and created one record.
   - DUPLICATE when the key existed; the corrected route ends at a Tools result labeled DUPLICATE and does not reach the write module.
5. After the successful first write, the Data Store showed exactly one record under key make-demo-100.
6. On 2026-09-23, a corrected Run once with the same event_id completed with overall status Success (5 operations). One bundle passed validation/high-priority routing; one bundle followed DUPLICATE; NEW EVENT and STORE NEW EVENT each handled zero bundles; Add/replace a record did not execute.
7. Rechecking the Data Store showed the same single record, key make-demo-100, size 46 bytes; no second record was created.

## Execution history

Eight Run once executions occurred across scenario iterations: five before the Data Store check, one successful first-write run, one failed replay before the filter fix, and one successful corrected replay. This is not eight runs of one unchanged final configuration.

## Evidence boundary

The successful corrected replay demonstrates duplicate suppression for the same synthetic event_id in this specific Make scenario. It is not a concurrency test and does not establish production reliability. The public sample output is a sanitized summary of UI observations, not a raw execution bundle. No screenshot or exported blueprint is included. No client data, credentials, or production integration was used; this is not client work.
