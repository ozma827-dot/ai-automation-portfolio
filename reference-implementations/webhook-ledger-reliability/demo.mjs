import { postRecord, startLedgerStub, startWebhookService } from "./src/server.mjs";

const sample = {
  event_id: "evt_synthetic_001",
  source_record_id: "order_synthetic_1042",
  customer_ref: "customer_synthetic_208",
  currency: "usd",
  amount_minor: 12500,
};

const ledger = await startLedgerStub({
  faultPolicy: (key, attempt) => {
    if (key === "demo-commit-then-503" && attempt === 1) return "commit_then_503";
    if (key === "demo-outage-001") return "unavailable";
    return "normal";
  },
});
const service = await startWebhookService({ ledgerUrl: ledger.baseUrl, maxAttempts: 3, retryDelayMs: 1 });

try {
  const first = await postRecord(service.baseUrl, { key: "demo-commit-then-503", record: sample });
  const firstBody = await first.json();
  const replay = await postRecord(service.baseUrl, { key: "demo-commit-then-503", record: sample });
  const replayBody = await replay.json();
  const outage = await postRecord(service.baseUrl, { key: "demo-outage-001", record: { ...sample, event_id: "evt_synthetic_002" } });
  const outageBody = await outage.json();
  const invalid = await postRecord(service.baseUrl, { key: "demo-invalid-001", record: { ...sample, amount_minor: -1 } });
  const invalidBody = await invalid.json();

  process.stdout.write(JSON.stringify({
    synthetic_demo: true,
    external_services_connected: false,
    actual_local_http_calls: true,
    success_after_commit_response_loss: {
      status: first.status,
      attempts: firstBody.attempts,
      trace: firstBody.trace,
      ledger_records_created: ledger.records.length,
    },
    same_key_replay: {
      status: replay.status,
      replayed: replayBody.replayed,
      ledger_records_created: ledger.records.length,
    },
    exhausted_failure: {
      status: outage.status,
      route: outageBody.status,
      attempts: outageBody.attempts,
      human_review_items: service.reviewQueue.length,
    },
    invalid_input: { status: invalid.status, route: invalidBody.status, error: invalidBody.errors[0] },
    audit_event_kinds: service.auditLog.map((event) => event.kind),
  }, null, 2) + "\n");
} finally {
  await Promise.all([service.close(), ledger.close()]);
}
