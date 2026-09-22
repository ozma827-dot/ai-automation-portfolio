import test from "node:test";
import assert from "node:assert/strict";
import { classifyRecord, normalizeEmail, processRecords, withRetry } from "../src/automation.mjs";

test("normalizes and routes an urgent automation record", async () => {
  assert.equal(normalizeEmail(" Buyer@Example.com "), "buyer@example.com");
  const result = await processRecords([{
    lead_id: "T-001", email: " Buyer@Example.com ", company: "Example", need: "n8n workflow", urgency: "ASAP", budget: 200,
  }]);
  assert.equal(result.accepted[0].classification.route, "CRM_AUTOMATION");
  assert.equal(result.audit.accepted_count, 1);
});

test("suppresses duplicate normalized emails", async () => {
  const result = await processRecords([
    { lead_id: "T-001", email: "a@example.com", company: "A", need: "workflow", budget: 100 },
    { lead_id: "T-002", email: " A@EXAMPLE.COM ", company: "B", need: "workflow", budget: 100 },
  ]);
  assert.equal(result.audit.duplicate_count, 1);
  assert.equal(result.duplicates[0].reason, "normalized_email_already_seen");
});

test("rejects missing or invalid required fields", async () => {
  const result = await processRecords([{ lead_id: "T-003", email: "bad", company: "", need: "" }]);
  assert.equal(result.audit.rejected_count, 1);
  assert.match(result.rejected[0].errors.join(";"), /company is required/);
  assert.match(result.rejected[0].errors.join(";"), /email must be a valid/);
});

test("retries a transient downstream step without external calls", async () => {
  let calls = 0;
  const value = await withRetry(async () => {
    calls += 1;
    if (calls < 2) throw new Error("transient");
    return "ok";
  }, { maxAttempts: 3, delayMs: 0 });
  assert.equal(value, "ok");
  assert.equal(calls, 2);
});

test("non-urgent or low-budget records route to human review", () => {
  assert.equal(classifyRecord({ need: "workflow", urgency: "normal", budget: 50 }).route, "HUMAN_REVIEW");
});
