import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { processRecords } from "../src/automation.mjs";

const demoDir = dirname(fileURLToPath(import.meta.url));
const inputPath = resolve(demoDir, "fixtures/input.json");
const input = JSON.parse(await fs.readFile(inputPath, "utf8"));
const result = await processRecords(input, { simulateTransientFailure: true });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
