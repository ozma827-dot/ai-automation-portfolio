import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { processRecords } from "../src/automation.mjs";

test("credential-free sample workflow matches its checked-in expected result", async () => {
  const demoDir = dirname(fileURLToPath(import.meta.url));
  const input = JSON.parse(await fs.readFile(resolve(demoDir, "fixtures/input.json"), "utf8"));
  const expected = JSON.parse(await fs.readFile(resolve(demoDir, "fixtures/expected.json"), "utf8"));
  const result = await processRecords(input, { simulateTransientFailure: true });

  assert.deepEqual({
    schema_version: result.schema_version,
    synthetic_demo: result.synthetic_demo,
    accepted_count: result.audit.accepted_count,
    rejected_count: result.audit.rejected_count,
    duplicate_count: result.audit.duplicate_count,
    accepted_route: result.accepted[0]?.classification.route,
    downstream: result.downstream,
  }, expected);
});
