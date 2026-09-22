import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";

const REQUIRED_FIELDS = ["lead_id", "email", "company", "need"];

export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function validateRecord(record) {
  const errors = [];
  for (const field of REQUIRED_FIELDS) {
    if (!String(record?.[field] ?? "").trim()) errors.push(`${field} is required`);
  }
  const email = normalizeEmail(record?.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("email must be a valid email-like value");
  }
  return errors;
}

export function classifyRecord(record) {
  const urgency = String(record.urgency ?? "normal").trim().toLowerCase();
  const budget = Number(record.budget ?? 0);
  const need = String(record.need ?? "").toLowerCase();
  const fit = /automation|workflow|n8n|make|zapier|crm|api|llm|agent/.test(need);
  const urgent = /urgent|asap|immediate|today|24h/.test(urgency);
  const route = fit && urgent && budget >= 100 ? "CRM_AUTOMATION" : "HUMAN_REVIEW";
  return { fit, urgent, route };
}

export async function withRetry(operation, options = {}) {
  const maxAttempts = Math.max(1, Number(options.maxAttempts ?? 3));
  const delayMs = Math.max(0, Number(options.delayMs ?? 0));
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

export async function processRecords(records, options = {}) {
  const accepted = [];
  const rejected = [];
  const duplicates = [];
  const routes = [];
  const seenEmails = new Set();

  for (const input of records) {
    const errors = validateRecord(input);
    if (errors.length) {
      rejected.push({ lead_id: input?.lead_id ?? null, errors });
      continue;
    }

    const email = normalizeEmail(input.email);
    if (seenEmails.has(email)) {
      duplicates.push({ lead_id: input.lead_id, email, reason: "normalized_email_already_seen" });
      continue;
    }
    seenEmails.add(email);

    const normalized = {
      lead_id: String(input.lead_id).trim(),
      email,
      company: String(input.company).trim(),
      need: String(input.need).trim(),
      urgency: String(input.urgency ?? "normal").trim().toLowerCase(),
      budget: Number(input.budget ?? 0),
      source: String(input.source ?? "synthetic").trim(),
    };
    const classification = classifyRecord(normalized);
    const entry = { ...normalized, classification };
    accepted.push(entry);
    routes.push({ lead_id: entry.lead_id, email, route: classification.route });
  }

  // This is a bounded, credential-free stand-in for a downstream write.
  // The demo deliberately makes no network request.
  let downstream = "COMPLETED";
  if (options.simulateTransientFailure) {
    let calls = 0;
    try {
      await withRetry(async () => {
        calls += 1;
        if (calls < 2) throw new Error("synthetic transient failure");
        return true;
      }, { maxAttempts: 3, delayMs: 0 });
      downstream = `COMPLETED_AFTER_RETRY_${calls}`;
    } catch {
      downstream = "HUMAN_REVIEW_AFTER_RETRY_EXHAUSTED";
    }
  }

  return {
    schema_version: "1.0",
    synthetic_demo: true,
    accepted,
    rejected,
    duplicates,
    routes,
    downstream,
    audit: {
      input_count: records.length,
      accepted_count: accepted.length,
      rejected_count: rejected.length,
      duplicate_count: duplicates.length,
    },
  };
}

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("Usage: node src/automation.mjs <input.json>");
  const input = JSON.parse(await fs.readFile(path, "utf8"));
  if (!Array.isArray(input)) throw new Error("Input JSON must be an array of records");
  process.stdout.write(`${JSON.stringify(await processRecords(input, { simulateTransientFailure: true }), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
