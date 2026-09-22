# Webhook → Ledger Reliability Reference

**Synthetic technical demonstration. Not a client case study.**

A dependency-free Node.js reference that receives a JSON webhook, validates and normalizes a record, sends it to a local HTTP ledger stub, retries transient failures with the same idempotency key, and routes exhausted or non-retryable failures to a human-review queue.

## Why this pattern

Recent buyer requests repeatedly describe already-built workflows that fail at an app/API boundary, where a blind retry could create a duplicate financial record. This reference isolates that risk in a runnable local system.

## Flow

HTTP POST /webhook/records → content type and body limits → required-field, amount, and currency validation → stable idempotency key and payload-conflict check → bounded HTTP retry to a local ledger adapter → accepted record or explicit human-review item → sanitized audit events.

## What is exercised

- Real HTTP requests over loopback to two local Node.js servers; no external service is called.
- A simulated “commit succeeded, response returned 503” case: the retry reuses the idempotency key and creates exactly one ledger record.
- Same-key replay and concurrent request coalescing.
- Reusing a key with a different payload returns 409 before a downstream write.
- Invalid input is rejected before delivery.
- Retryable 503 responses are bounded; exhaustion routes to human review.
- A non-retryable downstream 400 is not retried.
- Audit entries omit the synthetic record’s customer fields.

## Run and test

Requires Node.js 20+; no install or credentials are needed.

    node demo.mjs
    node --test test/*.test.mjs

The checked-in fixture demo/sample-input.json contains invented identifiers and no personal or financial customer data.

## Security and limits

- Servers bind only to 127.0.0.1; they are not exposed publicly.
- The example uses an in-memory idempotency store and review queue. A real deployment needs durable storage, retention/expiry, authentication, rate limits, monitoring, and an agreed recovery procedure.
- The ledger is a local stub—not QuickBooks, Katana, Make, n8n, or a production accounting system. This code does not prove deployment experience with those products.
- No API key, OAuth token, payment credential, customer record, or production write is used.

## Acceptance checks

For the synthetic order, a transient post-commit 503 must end in one accepted result after two attempts, exactly one ledger record, and a successful replay that makes no extra downstream request. Persistent transient failure must stop at the configured attempt limit and leave a review item.
