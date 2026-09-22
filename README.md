# AI Automation Portfolio

Project-based automation and workflow engineering focused on validation, deterministic processing, exception handling, traceability and reliable handoff.

Owner identity: WEN JING

## Featured Demo

This credential-free Synthetic AI Automation Demo processes lead-like records from a JSON webhook fixture. It demonstrates required-field validation, normalization, duplicate suppression, changed-record conflict detection, task/source isolation, exception routing, replay-safe behavior and deterministic output.

Verified test result: 35 automated tests / 35 executed (26 lead-routing tests and 9 HTTP reliability tests).

## Reference Implementation — Webhook-to-Ledger Reliability

The [Webhook-to-Ledger Reliability Reference](reference-implementations/webhook-ledger-reliability/README.md) exercises an HTTP boundary between two local Node.js mock servers: validation, stable idempotency, conflicting-payload detection, bounded retries, human-review routing and sanitized audit events.

A test simulates a ledger write succeeding before its response is lost; retrying with the same key creates exactly one record. This is a synthetic local demonstration, not a client case study or a QuickBooks, Katana, Make, n8n or production integration.

## What it does

The lead-routing workflow validates required fields, normalizes email addresses, suppresses duplicates, classifies fit and urgency, and routes records for automation or human review. Invalid records remain visible with field-level errors.

## Run and test

    node demo/run_demo.mjs
    node reference-implementations/webhook-ledger-reliability/demo.mjs
    npm test

The public proof bundle includes source, fixtures, tests, workflow representation and [proof.pdf](proof/proof.pdf).

## Authenticity boundary

Synthetic technical demonstration. Not a client case study.

No claim of production deployment, customer results, revenue, employment, education or client work. The original lead-routing demo makes no network calls; the reliability reference makes HTTP calls only between local mock servers. Neither connects to n8n, CRM, LLM, payment systems, QuickBooks, Katana, Make or a production account. A real integration would require buyer-owned credentials, an agreed schema, acceptance tests and funded scope.
