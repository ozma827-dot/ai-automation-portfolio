import test from "node:test";
import assert from "node:assert/strict";
import { postRecord, startLedgerStub, startWebhookService } from "../src/server.mjs";

const sample = {
  event_id: "evt_synthetic_test_001",
  source_record_id: "order_synthetic_001",
  customer_ref: "customer_synthetic_001",
  currency: "usd",
  amount_minor: 7400,
};

async function withSystem(t, faultPolicy = () => "normal", settings = {}) {
  const ledger = await startLedgerStub({ faultPolicy });
  const service = await startWebhookService({ ledgerUrl: ledger.baseUrl, retryDelayMs: 0, ...settings });
  t.after(async () => Promise.all([service.close(), ledger.close()]));
  return { ledger, service };
}

test("normalizes input, posts to the local HTTP adapter, and returns an auditable result", async (t) => {
  const { ledger, service } = await withSystem(t);
  const response = await postRecord(service.baseUrl, { key: "test-normal-001", record: sample });
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.status, "accepted");
  assert.equal(body.attempts, 1);
  assert.equal(ledger.records[0].currency, "USD");
  assert.equal(ledger.records[0].amount_minor, 7400);
  assert.ok(service.auditLog.some((entry) => entry.kind === "downstream_accepted"));
});

test("retries a lost response after commit without creating a second ledger record", async (t) => {
  const { ledger, service } = await withSystem(t, (key, attempt) =>
    key === "test-commit-loss" && attempt === 1 ? "commit_then_503" : "normal");
  const response = await postRecord(service.baseUrl, { key: "test-commit-loss", record: sample });
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.attempts, 2);
  assert.equal(ledger.records.length, 1);
  assert.equal(ledger.attemptsByKey.get("test-commit-loss"), 2);
});

test("replays the same idempotency key without repeating the downstream call", async (t) => {
  const { ledger, service } = await withSystem(t);
  const first = await postRecord(service.baseUrl, { key: "test-replay-001", record: sample });
  const firstBody = await first.json();
  const second = await postRecord(service.baseUrl, { key: "test-replay-001", record: sample });
  const secondBody = await second.json();
  assert.equal(second.status, 201);
  assert.equal(secondBody.record_id, firstBody.record_id);
  assert.equal(secondBody.replayed, true);
  assert.equal(ledger.attemptsByKey.get("test-replay-001"), 1);
  assert.equal(ledger.records.length, 1);
});

test("coalesces concurrent requests using the same key", async (t) => {
  const { ledger, service } = await withSystem(t);
  const [first, second] = await Promise.all([
    postRecord(service.baseUrl, { key: "test-concurrent-001", record: sample }),
    postRecord(service.baseUrl, { key: "test-concurrent-001", record: sample }),
  ]);
  assert.deepEqual([first.status, second.status], [201, 201]);
  assert.equal(ledger.attemptsByKey.get("test-concurrent-001"), 1);
  assert.equal(ledger.records.length, 1);
});

test("rejects reuse of an idempotency key with a different payload", async (t) => {
  const { ledger, service } = await withSystem(t);
  await postRecord(service.baseUrl, { key: "test-conflict-001", record: sample });
  const response = await postRecord(service.baseUrl, {
    key: "test-conflict-001",
    record: { ...sample, amount_minor: 9999 },
  });
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.error, "idempotency_key_reused_with_different_payload");
  assert.equal(ledger.records.length, 1);
  assert.equal(ledger.attemptsByKey.get("test-conflict-001"), 1);
});

test("rejects invalid amounts before any downstream request", async (t) => {
  const { ledger, service } = await withSystem(t);
  const response = await postRecord(service.baseUrl, {
    key: "test-invalid-001",
    record: { ...sample, amount_minor: -1 },
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.status, "rejected");
  assert.equal(ledger.records.length, 0);
  assert.equal(service.auditLog.some((entry) => entry.kind === "downstream_attempt"), false);
});

test("routes exhausted retryable failures to human review after a bounded number of attempts", async (t) => {
  const { ledger, service } = await withSystem(t, (key) => key === "test-outage-001" ? "unavailable" : "normal", { maxAttempts: 3 });
  const response = await postRecord(service.baseUrl, { key: "test-outage-001", record: sample });
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(body.status, "human_review");
  assert.equal(body.attempts, 3);
  assert.equal(ledger.attemptsByKey.get("test-outage-001"), 3);
  assert.equal(service.reviewQueue.length, 1);
});

test("does not retry a non-retryable downstream 400", async (t) => {
  const { ledger, service } = await withSystem(t, (key) => key === "test-bad-request" ? "bad_request" : "normal");
  const response = await postRecord(service.baseUrl, { key: "test-bad-request", record: sample });
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(body.attempts, 1);
  assert.equal(ledger.attemptsByKey.get("test-bad-request"), 1);
  assert.equal(service.reviewQueue[0].reason, "downstream_non_retryable");
});

test("rejects missing keys, wrong content types, and unknown routes", async (t) => {
  const { service } = await withSystem(t);
  const noKey = await postRecord(service.baseUrl, { key: "short", record: sample });
  assert.equal(noKey.status, 400);
  const wrongType = await postRecord(service.baseUrl, { key: "test-content-type", record: sample, contentType: "text/plain" });
  assert.equal(wrongType.status, 415);
  const unknown = await fetch(service.baseUrl + "/not-a-route");
  assert.equal(unknown.status, 404);
});
