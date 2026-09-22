# AI Automation Portfolio

Project-based automation and workflow engineering focused on validation, deterministic processing, exception handling, traceability and reliable handoff.

Owner identity: WEN JING

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

The verified test command currently passes **26 automated tests / 26 executed**.

## What it does

The workflow validates required fields, normalizes email addresses, suppresses duplicate normalized emails, classifies fit and urgency, and routes accepted records to either `CRM_AUTOMATION` or `HUMAN_REVIEW`. Invalid records remain visible with field-level errors.

## Architecture

```text
Webhook / JSON input
        |
        v
Validate required fields ---- invalid ----> structured error + human review
        |
        v
Normalize fields and email
        |
        v
Deduplicate by normalized email
        |
        v
Classify fit and urgency
        |
        +---- high fit + urgent + budget ----> CRM_AUTOMATION
        |
        +---- otherwise ---------------------> HUMAN_REVIEW
        |
        v
Auditable deterministic JSON result
```

The credential-free n8n-style representation is in [`demo/workflow.json`](demo/workflow.json), with a visual diagram in [`demo/assets/architecture.svg`](demo/assets/architecture.svg).

## Inputs

Required fields are `lead_id`, `email`, `company`, and `need`. Optional fields are `urgency`, `budget`, and `source`. The checked-in sample is synthetic and contains no client data or credentials: [`demo/fixtures/input.json`](demo/fixtures/input.json).

## Outputs

The program returns normalized accepted records, field-level rejections, duplicate records, routing decisions, retry status, and audit counts. The checked-in expected summary is [`demo/fixtures/expected.json`](demo/fixtures/expected.json).

## Failure paths and handoff

- Missing required fields are rejected before routing.
- Invalid email-like values are rejected with a readable reason.
- Duplicate normalized emails are suppressed deterministically.
- A transient downstream step retries with a bounded attempt limit.
- Exhausted retries remain visible and can be sent to human review; the demo never silently treats failure as success.
- No network call, production CRM write, payment action, or external credential is used.

## Run it

```bash
node demo/run_demo.mjs
npm test
```

The public proof bundle includes the source, fixtures, test suite, workflow representation, and a generated test-evidence PDF: [`proof/proof.pdf`](proof/proof.pdf).

## Authenticity boundary

**Synthetic technical demonstration. Not a client case study.**

This repository makes no claim of production deployment, customer results, revenue, prior employment, education, or client work. The demo does not connect to n8n, a CRM, an LLM provider, a payment system, or a production account. Real integrations would require buyer-owned credentials, an agreed schema, acceptance tests, and a funded scope.
