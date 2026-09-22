import test from "node:test";
import assert from "node:assert/strict";
import { classifyRecord, normalizeEmail, processRecords, validateRecord, withRetry } from "../src/automation.mjs";

test("normalizes a missing value to an empty string", () => {
  assert.equal(normalizeEmail(undefined), "");
});

test("trims and lowercases an email", () => {
  assert.equal(normalizeEmail("  PERSON@Example.COM  "), "person@example.com");
});

test("preserves a plus-addressing tag during normalization", () => {
  assert.equal(normalizeEmail(" User+demo@Example.com "), "user+demo@example.com");
});

test("reports a missing lead id", () => {
  assert.ok(validateRecord({ email: "a@example.com", company: "A", need: "workflow" }).includes("lead_id is required"));
});

test("reports a missing company", () => {
  assert.ok(validateRecord({ lead_id: "A", email: "a@example.com", company: "", need: "workflow" }).includes("company is required"));
});

test("reports a missing need", () => {
  assert.ok(validateRecord({ lead_id: "A", email: "a@example.com", company: "A", need: "" }).includes("need is required"));
});

test("reports an invalid email-like value", () => {
  assert.ok(validateRecord({ lead_id: "A", email: "not-an-email", company: "A", need: "workflow" }).includes("email must be a valid email-like value"));
});

test("allows optional fields to be omitted", () => {
  assert.deepEqual(validateRecord({ lead_id: "A", email: "a@example.com", company: "A", need: "workflow" }), []);
});

test("recognizes Make as an automation fit", () => {
  assert.equal(classifyRecord({ need: "Make workflow", urgency: "ASAP", budget: 100 }).fit, true);
});

test("recognizes Zapier as an automation fit", () => {
  assert.equal(classifyRecord({ need: "Zapier workflow", urgency: "ASAP", budget: 100 }).fit, true);
});

test("recognizes API as an automation fit", () => {
  assert.equal(classifyRecord({ need: "API integration", urgency: "ASAP", budget: 100 }).fit, true);
});

test("recognizes LLM as an automation fit", () => {
  assert.equal(classifyRecord({ need: "LLM workflow", urgency: "ASAP", budget: 100 }).fit, true);
});

test("recognizes agent as an automation fit", () => {
  assert.equal(classifyRecord({ need: "agent workflow", urgency: "ASAP", budget: 100 }).fit, true);
});

test("keeps an unrelated design request out of the automation fit", () => {
  assert.equal(classifyRecord({ need: "brand illustration", urgency: "ASAP", budget: 100 }).fit, false);
});

test("accepts today as an urgent signal when budget is sufficient", () => {
  assert.equal(classifyRecord({ need: "workflow", urgency: "today", budget: 100 }).route, "CRM_AUTOMATION");
});

test("routes a low-budget urgent request to human review", () => {
  assert.equal(classifyRecord({ need: "workflow", urgency: "urgent", budget: 99 }).route, "HUMAN_REVIEW");
});

test("routes a normal-urgency request to human review", () => {
  assert.equal(classifyRecord({ need: "workflow", budget: 200 }).route, "HUMAN_REVIEW");
});

test("preserves the source field in normalized accepted output", async () => {
  const result = await processRecords([{ lead_id: "A", email: "a@example.com", company: "A", need: "workflow", source: "fixture" }]);
  assert.equal(result.accepted[0].source, "fixture");
});

test("rejects malformed records before they can be accepted", async () => {
  const result = await processRecords([{ lead_id: "A", email: "bad", company: "A", need: "" }]);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected.length, 1);
});

test("withRetry stops after the configured attempt limit", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => {
      calls += 1;
      throw new Error("synthetic failure");
    }, { maxAttempts: 2, delayMs: 0 }),
    /synthetic failure/,
  );
  assert.equal(calls, 2);
});
