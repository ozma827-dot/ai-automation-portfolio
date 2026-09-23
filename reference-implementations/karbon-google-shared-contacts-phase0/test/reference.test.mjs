import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  WebhookInbox,
  buildReconciliationReport,
  buildSharedContactAtomEntry,
  createGoogleSharedContact,
  executeVersionedUpdate,
  fetchKarbonContact,
  isWellFormedXml,
  normalizeContact,
  normalizeKarbonWebhookEvents,
  normalizeE164Phone,
  normalizeEmail,
  prepareVersionedSharedContactUpdate,
  requestWithKarbonRetry,
  resolveIdentity,
  scanPaged,
  verifyKarbonSignature,
  IdempotentSyntheticWriter,
  writeWithReplaySafety,
} from "../src/index.mjs";

const signingKey = "synthetic-signing-key-012345";
const eventPayload = {
  ResourcePermaKey: "synthetic-contact-001",
  ResourceType: "Contact",
  ActionType: "Updated",
  TimeStamp: "2026-09-23T12:00:00Z",
};

test("Karbon webhook verifies raw-body HMAC and acknowledges via the queue boundary", async () => {
  const rawBody = JSON.stringify(eventPayload);
  const signature = createHmac("sha256", signingKey).update(rawBody).digest("hex");
  const queue = [];
  const inbox = new WebhookInbox(async (event) => queue.push(event));
  const result = await inbox.accept({ rawBody, signature, signingKey });
  assert.equal(result.status, 202);
  assert.equal(result.accepted, 1);
  assert.equal(queue[0].ResourcePermaKey, "synthetic-contact-001");
  assert.equal(verifyKarbonSignature(rawBody, signature, signingKey), true);
});

test("repeated webhook delivery is deduplicated and batched Timestamp spelling is accepted", async () => {
  const batch = { Events: [eventPayload, { ...eventPayload, Timestamp: eventPayload.TimeStamp }] };
  delete batch.Events[1].TimeStamp;
  const rawBody = JSON.stringify(batch);
  const signature = createHmac("sha256", signingKey).update(rawBody).digest("hex");
  const queue = [];
  const inbox = new WebhookInbox(async (event) => queue.push(event));
  const first = await inbox.accept({ rawBody, signature, signingKey });
  const duplicate = await inbox.accept({ rawBody, signature, signingKey });
  assert.equal(first.accepted, 1);
  assert.equal(first.duplicates, 1);
  assert.equal(duplicate.accepted, 0);
  assert.equal(duplicate.duplicates, 2);
  assert.equal(queue.length, 1);
  assert.equal(normalizeKarbonWebhookEvents(batch).length, 2);
});

test("a burst of distinct webhook events is accepted once each and replayed safely", async () => {
  const events = Array.from({ length: 25 }, (_, index) => ({
    ...eventPayload,
    ResourcePermaKey: `synthetic-contact-${index}`,
    TimeStamp: `2026-09-23T12:${String(index).padStart(2, "0")}:00Z`,
  }));
  const rawBody = JSON.stringify({ Events: events });
  const signature = createHmac("sha256", signingKey).update(rawBody).digest("hex");
  const queue = [];
  const inbox = new WebhookInbox(async (event) => queue.push(event));
  const first = await inbox.accept({ rawBody, signature, signingKey });
  const replay = await inbox.accept({ rawBody, signature, signingKey });
  assert.equal(first.accepted, 25);
  assert.equal(first.duplicates, 0);
  assert.equal(replay.accepted, 0);
  assert.equal(replay.duplicates, 25);
  assert.equal(queue.length, 25);
});

test("invalid signature and malformed/missing webhook fields are rejected", async () => {
  const rawBody = JSON.stringify(eventPayload);
  const inbox = new WebhookInbox(async () => assert.fail("must not enqueue"));
  assert.equal((await inbox.accept({ rawBody, signature: "00", signingKey })).status, 401);
  assert.equal((await inbox.accept({ rawBody: "{", signature: "00", signingKey })).status, 401);
  assert.throws(() => normalizeKarbonWebhookEvents({ ResourcePermaKey: "only-key" }), /required event field/);
});

test("identity resolution uses Karbon ID, normalized email, then E.164 phone", () => {
  const source = { karbonId: "K-1", name: "Casey Example", email: "CASEY@EXAMPLE.COM", phone: "+1 (212) 555-0101" };
  const existing = [{ karbonId: "K-1", name: "Casey Example", email: "casey@example.com", phone: "+12125550101" }];
  assert.deepEqual(resolveIdentity(source, existing), { action: "UPDATE", matchedBy: "karbonId", record: existing[0] });
  assert.equal(resolveIdentity({ ...source, karbonId: "new-key", phone: "+1 212-555-0101" }, existing).matchedBy, "email");
  assert.equal(resolveIdentity({ ...source, karbonId: "new-key", email: "other@example.com" }, existing).matchedBy, "phone");
  assert.equal(resolveIdentity({ ...source, karbonId: "new-key", email: "new@example.com", phone: "+1 646 555 0199" }, existing).action, "CREATE");
});

test("duplicate email/phone and cross-key conflicts route to human review, never merge", () => {
  const a = { karbonId: "K-A", name: "A", email: "same@example.com", phone: "+12125550101" };
  const b = { karbonId: "K-B", name: "B", email: "same@example.com", phone: "+16465550199" };
  assert.equal(resolveIdentity({ karbonId: "K-X", name: "X", email: "same@example.com" }, [a, b]).reason, "DUPLICATE_IDENTIFIER");
  const c = { karbonId: "K-C", name: "C", email: "c@example.com", phone: "+12125550101" };
  assert.equal(resolveIdentity({ karbonId: "K-X", name: "X", email: "c@example.com", phone: "+12125550101" }, [a, c]).reason, "DUPLICATE_IDENTIFIER");
  assert.equal(resolveIdentity({ karbonId: "K-A", name: "A", email: "c@example.com" }, [a, c]).reason, "CONFLICTING_IDENTIFIERS");
});

test("invalid email/phone and missing match keys are review cases without country-code guessing", () => {
  assert.equal(normalizeEmail("  PERSON@EXAMPLE.COM "), "person@example.com");
  assert.equal(normalizeEmail("bad-address"), null);
  assert.equal(normalizeE164Phone("+1 (212) 555-0101"), "+12125550101");
  assert.equal(normalizeE164Phone("212-555-0101"), null);
  assert.equal(resolveIdentity({ karbonId: "K-1", name: "X", email: "broken" }, []).reason, "INVALID_SOURCE_FIELD");
  assert.equal(resolveIdentity({ karbonId: "K-1", name: "X", phone: "555" }, []).reason, "INVALID_SOURCE_FIELD");
  assert.equal(resolveIdentity({ karbonId: "K-1", name: "X" }, []).reason, "NO_MATCH_KEYS");
});

test("Google Domain Shared Contacts Atom/XML create payload includes expected fields and escaped text", () => {
  const xml = buildSharedContactAtomEntry({
    karbonId: "K-100",
    name: "Casey & Morgan <Demo>",
    email: "casey@example.test",
    phone: "+12125550101",
    address: { street: "1 Main St", city: "Example", region: "NY", postcode: "10001", country: "US", formattedAddress: "1 Main St, Example, NY" },
  });
  assert.equal(isWellFormedXml(xml), true);
  assert.match(xml, /<atom:entry/);
  assert.match(xml, /gd:email/);
  assert.match(xml, /gd:phoneNumber/);
  assert.match(xml, /gd:structuredPostalAddress/);
  assert.match(xml, /gd:extendedProperty name="com\.example\.karbonId" value="K-100"/);
  assert.match(xml, /Casey &amp; Morgan &lt;Demo&gt;/);
  assert.throws(() => buildSharedContactAtomEntry({ karbonId: "K-1", name: "", email: "bad" }), /cannot be serialized/);
});

test("versioned update preserves unknown server XML and targets the exact edit URL", async () => {
  const editUrl = "https://www.google.com/m8/feeds/contacts/example.test/full/123/9001";
  const existingEntryXml = `<entry xmlns="${"http://www.w3.org/2005/Atom"}" xmlns:gd="http://schemas.google.com/g/2005"><id>https://www.google.com/m8/feeds/contacts/example.test/base/123</id><link rel="edit" href="${editUrl}"/><title>Server-only title</title><gd:name><gd:fullName>Old Name</gd:fullName></gd:name><gd:email rel="http://schemas.google.com/g/2005#work" primary="true" address="old@example.test"/><gd:extendedProperty name="com.example.karbonId" value="K-123"/><gd:extendedProperty name="other" value="keep-me"/></entry>`;
  const plan = prepareVersionedSharedContactUpdate({ currentEntryXml: existingEntryXml, desiredContact: { karbonId: "K-123", name: "New Name", email: "new@example.test" }, latestEditUrl: editUrl });
  assert.equal(plan.status, "READY");
  assert.equal(plan.url, editUrl);
  assert.match(plan.body, /Server-only title/);
  assert.match(plan.body, /name="other" value="keep-me"/);
  assert.match(plan.body, /new@example\.test/);
  assert.doesNotMatch(plan.body, /old@example\.test/);
  let called = false;
  const stale = await executeVersionedUpdate(plan, `${editUrl}/stale`, async () => { called = true; return { status: 200, ok: true }; });
  assert.equal(stale.reason, "STALE_EDIT_URL");
  assert.equal(called, false);
  const serverConflict = await executeVersionedUpdate(plan, editUrl, async () => ({ status: 409, ok: false, currentEntry: "latest" }));
  assert.equal(serverConflict.reason, "SERVER_VERSION_CONFLICT");
});

test("malformed XML and missing versioned edit URL are rejected before update", () => {
  assert.equal(isWellFormedXml("<entry><gd:name></entry>"), false);
  assert.equal(isWellFormedXml("<!DOCTYPE entry [<!ENTITY x 'boom'>]><entry>&x;</entry>"), false);
  assert.throws(() => prepareVersionedSharedContactUpdate({ currentEntryXml: "<entry><id>1</id></entry>", desiredContact: { karbonId: "K-1", name: "X" } }), /id and edit link/);
});

test("Karbon 429 honors Retry-After, then succeeds; exhaustion is bounded", async () => {
  const delays = [];
  let calls = 0;
  const success = await requestWithKarbonRetry(async () => {
    calls += 1;
    if (calls === 1) return { status: 429, ok: false, headers: { get: () => "2" } };
    return { status: 200, ok: true, json: async () => ({ ContactKey: "K-1" }) };
  }, { maxAttempts: 3, baseDelayMs: 100, sleep: async (ms) => delays.push(ms) });
  assert.equal(success.status, 200);
  assert.deepEqual(delays, [2000]);
  let exhaustedCalls = 0;
  await assert.rejects(() => requestWithKarbonRetry(async () => {
    exhaustedCalls += 1;
    return { status: 429, ok: false, headers: { get: () => "0" } };
  }, { maxAttempts: 3, baseDelayMs: 10, sleep: async () => {} }), /429/);
  assert.equal(exhaustedCalls, 3);
});

test("Karbon request timeout retries are bounded and a later response can succeed", async () => {
  let calls = 0;
  const delays = [];
  const response = await requestWithKarbonRetry(async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("synthetic timeout"), { name: "TimeoutError" });
    return { status: 200, ok: true };
  }, { maxAttempts: 3, baseDelayMs: 20, sleep: async (ms) => delays.push(ms) });
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [20]);
  let exhausted = 0;
  await assert.rejects(() => requestWithKarbonRetry(async () => {
    exhausted += 1;
    throw Object.assign(new Error("still timed out"), { name: "AbortError" });
  }, { maxAttempts: 2, sleep: async () => {} }), /still timed out/);
  assert.equal(exhausted, 2);
});

test("a long Retry-After is deferred instead of sleeping inside the worker", async () => {
  let calls = 0;
  await assert.rejects(() => requestWithKarbonRetry(async () => {
    calls += 1;
    return { status: 429, ok: false, headers: { get: () => "120" } };
  }, { maxAttempts: 5, maxInlineRetryAfterMs: 30_000, sleep: async () => assert.fail("must be deferred") }), (error) => {
    assert.equal(error.code, "RATE_LIMIT_DEFERRED");
    assert.equal(error.retryAfterMs, 120_000);
    return true;
  });
  assert.equal(calls, 1);
});

test("Google shared-contact create uses OAuth bearer, Atom XML and GData version headers", async () => {
  const xml = buildSharedContactAtomEntry({ karbonId: "K-1", name: "Synthetic Contact", email: "person@example.test" });
  let observed;
  const result = await createGoogleSharedContact({
    collectionUrl: "https://www.google.com/m8/feeds/contacts/example.test/full",
    accessToken: "synthetic-token",
    entryXml: xml,
    fetchImpl: async (url, options) => {
      observed = { url, options };
      return { ok: true, status: 201, text: async () => "created" };
    },
  });
  assert.equal(result.status, 201);
  assert.equal(observed.options.method, "POST");
  assert.equal(observed.options.headers.Authorization, "Bearer synthetic-token");
  assert.equal(observed.options.headers["Content-Type"], "application/atom+xml");
  assert.equal(observed.options.headers["GData-Version"], "3.0");
  assert.equal(observed.options.body, xml);
  await assert.rejects(() => createGoogleSharedContact({ collectionUrl: "https://example.test", accessToken: "x", entryXml: "<broken>" }), /malformed/);
});

test("Karbon fetch abstraction uses Contact endpoint and required auth headers", async () => {
  let seen;
  const record = await fetchKarbonContact({
    resourcePermaKey: "K/1",
    accessToken: "synthetic-token",
    accessKey: "synthetic-access-key",
    fetchImpl: async (url, options) => { seen = { url, options }; return { status: 200, ok: true, json: async () => ({ ContactKey: "K/1" }) }; },
    retryOptions: { sleep: async () => {} },
  });
  assert.equal(seen.url, "https://api.karbonhq.com/v3/Contacts/K%2F1");
  assert.equal(seen.options.headers.AccessKey, "synthetic-access-key");
  assert.equal(record.ContactKey, "K/1");
});

test("lost response after write replays safely to one logical contact write", async () => {
  const writer = new IdempotentSyntheticWriter();
  let injected = false;
  const result = await writeWithReplaySafety(writer, {
    idempotencyKey: "event-1",
    contact: normalizeContact({ karbonId: "K-1", name: "Casey", email: "casey@example.test" }),
  }, { afterCommit: async () => { if (!injected) { injected = true; throw Object.assign(new Error("synthetic response lost"), { responseLost: true }); } } });
  assert.equal(result.replayed, true);
  assert.equal(writer.logicalWrites, 1);
  assert.equal(writer.entries.size, 1);
});

test("pagination checkpoint resumes at the last fully handled page", async () => {
  const state = new Map();
  const checkpointStore = { get: async (key) => state.get(key) ?? null, set: async (key, value) => state.set(key, value) };
  const pageData = { null: { items: [1], nextPageToken: "p2" }, p2: { items: [2], nextPageToken: "p3" }, p3: { items: [3], nextPageToken: null } };
  let failOnce = true;
  await assert.rejects(() => scanPaged({
    fetchPage: async (cursor) => pageData[cursor],
    checkpointStore,
    checkpointKey: "karbon-full-scan",
    applyPage: async (items) => { if (items[0] === 2 && failOnce) { failOnce = false; throw new Error("synthetic worker restart"); } return items; },
  }), /restart/);
  assert.equal(state.get("karbon-full-scan"), "p2");
  const resumed = await scanPaged({ fetchPage: async (cursor) => pageData[cursor], checkpointStore, checkpointKey: "karbon-full-scan", applyPage: async (items) => items });
  assert.deepEqual(resumed, [2, 3]);
  assert.equal(state.get("karbon-full-scan"), null);
});

test("reconciliation reports created, updated, unchanged, conflict, failed, and manual review separately", () => {
  const report = buildReconciliationReport(
    [
      { karbonId: "K-new", name: "New Person", email: "new@example.test" },
      { karbonId: "K-edit", name: "Changed Person", email: "edit@example.test" },
      { karbonId: "K-same", name: "Same Person", email: "same@example.test" },
      { karbonId: "K-review", name: "Review Person", email: "dup@example.test" },
    ],
    [
      { karbonId: "K-edit", name: "Old Name", email: "edit@example.test" },
      { karbonId: "K-same", name: "Same Person", email: "same@example.test" },
      { karbonId: "K-other", name: "Other", email: "dup@example.test" },
      { karbonId: "K-other-2", name: "Other Two", email: "dup@example.test" },
    ],
    { failed: ["K-failed"] },
  );
  assert.deepEqual(report.created, ["K-new"]);
  assert.deepEqual(report.updated, ["K-edit"]);
  assert.deepEqual(report.unchanged, ["K-same"]);
  assert.deepEqual(report.manualReview, [{ karbonId: "K-review", reason: "DUPLICATE_IDENTIFIER" }]);
  assert.deepEqual(report.failed, ["K-failed"]);
  assert.deepEqual(report.conflict, []);
});

test("mismatched Karbon ID and email in an existing contact is reported as conflict", () => {
  const report = buildReconciliationReport(
    [{ karbonId: "K-A", name: "Person A", email: "a@example.test" }],
    [
      { karbonId: "K-A", name: "Person A old", email: "old@example.test" },
      { karbonId: "K-B", name: "Person B", email: "a@example.test" },
    ],
  );
  assert.deepEqual(report.conflict, ["K-A"]);
  assert.deepEqual(report.updated, []);
  assert.deepEqual(report.created, []);
});

import { runDemo } from "../demo.mjs";

test("local HTTP integration validates duplicate webhook, full-record fetch, and one contact write", async () => {
  const result = await runDemo();
  assert.equal(result.webhookAccepted, 1);
  assert.equal(result.webhookDuplicates, 1);
  assert.equal(result.fullRecordFetches, 1);
  assert.equal(result.contactCreateStatus, 201);
  assert.equal(result.logicalWrites, 1);
  assert.equal(result.externalCalls, 0);
});
