import { createHash, randomUUID } from "node:crypto";
import http from "node:http";

const MAX_BODY_BYTES = 64 * 1024;

function json(res, status, body) {
  const output = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(output),
    "cache-control": "no-store",
  });
  res.end(output);
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      resolve("http://127.0.0.1:" + address.port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    if (!server.listening) return resolve();
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("request body exceeds 65536 bytes");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("request body must be valid JSON");
    error.status = 400;
    throw error;
  }
}

function normalizeRecord(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { record: null, errors: ["body must be a JSON object"] };
  }

  const record = {
    event_id: String(value.event_id ?? "").trim(),
    source_record_id: String(value.source_record_id ?? "").trim(),
    customer_ref: String(value.customer_ref ?? "").trim(),
    currency: String(value.currency ?? "").trim().toUpperCase(),
    amount_minor: value.amount_minor,
  };

  for (const field of ["event_id", "source_record_id", "customer_ref"]) {
    if (!record[field]) errors.push(field + " is required");
    else if (record[field].length > 128) errors.push(field + " must be at most 128 characters");
  }
  if (!/^[A-Z]{3}$/.test(record.currency)) errors.push("currency must be a three-letter code");
  if (!Number.isSafeInteger(record.amount_minor) || record.amount_minor <= 0) {
    errors.push("amount_minor must be a positive safe integer");
  }
  return { record, errors };
}

function audit(auditLog, kind, fields = {}) {
  auditLog.push({ at: new Date().toISOString(), kind, ...fields });
}

function retryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

export async function startLedgerStub({ faultPolicy = () => "normal" } = {}) {
  const records = [];
  const recordsByKey = new Map();
  const attemptsByKey = new Map();
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/api/records") {
      return json(res, 404, { error: "not_found" });
    }
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || !key) return json(res, 400, { error: "idempotency_key_required" });

    const attempt = (attemptsByKey.get(key) ?? 0) + 1;
    attemptsByKey.set(key, attempt);
    const fault = faultPolicy(key, attempt);
    if (fault === "unavailable") return json(res, 503, { error: "synthetic_service_unavailable" });
    if (fault === "bad_request") return json(res, 400, { error: "synthetic_non_retryable_error" });

    let body;
    try {
      body = await readJson(req);
    } catch (error) {
      return json(res, error.status ?? 400, { error: "invalid_json" });
    }

    let created = recordsByKey.get(key);
    let replayed = Boolean(created);
    if (!created) {
      created = {
        record_id: "ledger-" + createHash("sha256").update(key).digest("hex").slice(0, 12),
        source_record_id: body.source_record_id,
        amount_minor: body.amount_minor,
        currency: body.currency,
      };
      recordsByKey.set(key, created);
      records.push(created);
      replayed = false;
    }

    if (fault === "commit_then_503") return json(res, 503, { error: "synthetic_response_lost_after_commit" });
    return json(res, replayed ? 200 : 201, { ...created, replayed });
  });

  const baseUrl = await listen(server);
  return {
    baseUrl,
    records,
    attemptsByKey,
    close: () => close(server),
  };
}

export async function startWebhookService({
  ledgerUrl,
  maxAttempts = 3,
  retryDelayMs = 5,
  requestTimeoutMs = 1000,
} = {}) {
  if (!ledgerUrl) throw new Error("ledgerUrl is required");
  const auditLog = [];
  const reviewQueue = [];
  const idempotency = new Map();

  async function deliver(record, key, requestId) {
    const trace = [];
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      audit(auditLog, "downstream_attempt", { request_id: requestId, attempt });
      try {
        const response = await fetch(ledgerUrl + "/api/records", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": key,
            "x-request-id": requestId,
          },
          body: JSON.stringify(record),
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
        const responseBody = await response.json().catch(() => ({ error: "invalid_downstream_response" }));
        trace.push({ attempt, status: response.status });
        if (response.ok) {
          audit(auditLog, "downstream_accepted", { request_id: requestId, attempt, status: response.status });
          return {
            status: 201,
            body: {
              status: "accepted",
              request_id: requestId,
              record_id: responseBody.record_id,
              attempts: attempt,
              trace,
            },
          };
        }
        if (!retryableStatus(response.status)) {
          audit(auditLog, "downstream_rejected", { request_id: requestId, attempt, status: response.status });
          const item = { request_id: requestId, reason: "downstream_non_retryable", status: response.status };
          reviewQueue.push(item);
          return { status: 502, body: { status: "human_review", ...item, attempts: attempt, trace } };
        }
        audit(auditLog, "downstream_retryable_failure", { request_id: requestId, attempt, status: response.status });
      } catch (error) {
        trace.push({ attempt, error: error.name === "TimeoutError" ? "timeout" : "connection_error" });
        audit(auditLog, "downstream_transport_failure", { request_id: requestId, attempt });
      }

      if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
    }

    const item = { request_id: requestId, reason: "downstream_retries_exhausted" };
    reviewQueue.push(item);
    audit(auditLog, "routed_to_human_review", item);
    return { status: 502, body: { status: "human_review", ...item, attempts: maxAttempts, trace } };
  }

  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/webhook/records") {
      return json(res, 404, { error: "not_found" });
    }
    const requestId = randomUUID();
    if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      audit(auditLog, "rejected_content_type", { request_id: requestId });
      return json(res, 415, { status: "rejected", request_id: requestId, error: "application_json_required" });
    }

    let input;
    try {
      input = await readJson(req);
    } catch (error) {
      audit(auditLog, "rejected_body", { request_id: requestId, status: error.status ?? 400 });
      return json(res, error.status ?? 400, { status: "rejected", request_id: requestId, error: error.message });
    }
    const { record, errors } = normalizeRecord(input);
    if (errors.length) {
      audit(auditLog, "rejected_validation", { request_id: requestId, fields: errors.map((item) => item.split(" ")[0]) });
      return json(res, 400, { status: "rejected", request_id: requestId, errors });
    }

    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
      audit(auditLog, "rejected_idempotency_key", { request_id: requestId });
      return json(res, 400, { status: "rejected", request_id: requestId, error: "valid_idempotency_key_required" });
    }
    const payloadHash = createHash("sha256").update(JSON.stringify(record)).digest("hex");
    const existing = idempotency.get(key);
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        audit(auditLog, "idempotency_conflict", { request_id: requestId });
        return json(res, 409, { status: "conflict", request_id: requestId, error: "idempotency_key_reused_with_different_payload" });
      }
      audit(auditLog, "idempotent_replay", { request_id: requestId });
      const prior = existing.result ?? await existing.promise;
      return json(res, prior.status, { ...prior.body, replayed: true });
    }

    audit(auditLog, "accepted", { request_id: requestId });
    const entry = { payloadHash, result: null, promise: null };
    idempotency.set(key, entry);
    entry.promise = deliver(record, key, requestId);
    entry.result = await entry.promise;
    entry.promise = null;
    return json(res, entry.result.status, entry.result.body);
  });

  const baseUrl = await listen(server);
  return {
    baseUrl,
    auditLog,
    reviewQueue,
    close: () => close(server),
  };
}

export async function postRecord(baseUrl, { key, record, contentType = "application/json" }) {
  return fetch(baseUrl + "/webhook/records", {
    method: "POST",
    headers: { "content-type": contentType, "idempotency-key": key },
    body: JSON.stringify(record),
  });
}
