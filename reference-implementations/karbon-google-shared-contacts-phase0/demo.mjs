import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import {
  WebhookInbox,
  buildSharedContactAtomEntry,
  createGoogleSharedContact,
  fetchKarbonContact,
  isWellFormedXml,
  normalizeContact,
  resolveIdentity,
} from "./src/index.mjs";

const sampleUrl = new URL("./demo/sample-input.json", import.meta.url);

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

export async function runDemo() {
  const sample = JSON.parse(await readFile(sampleUrl, "utf8"));
  const queue = [];
  const stats = { fullRecordFetches: 0, logicalWrites: 0, externalCalls: 0 };
  const inbox = new WebhookInbox(async (event) => { queue.push(event); });
  const server = createServer(async (request, response) => {
    try {
      if (request.method === "POST" && request.url === "/webhooks/karbon") {
        const rawBody = await readBody(request);
        const result = await inbox.accept({
          rawBody,
          signature: request.headers.signature,
          signingKey: "synthetic-local-signing-key",
        });
        sendJson(response, result.status, result);
        return;
      }
      if (request.method === "GET" && request.url === "/v3/Contacts/synthetic-contact-001") {
        stats.fullRecordFetches += 1;
        sendJson(response, 200, sample.contact);
        return;
      }
      if (request.method === "POST" && request.url === "/google/contacts/example.test/full") {
        const body = (await readBody(request)).toString("utf8");
        if (request.headers["content-type"] !== "application/atom+xml" || request.headers["gdata-version"] !== "3.0" || !isWellFormedXml(body)) {
          sendJson(response, 400, { error: "invalid synthetic Atom request" });
          return;
        }
        stats.logicalWrites += 1;
        response.writeHead(201, { "Content-Type": "application/atom+xml" });
        response.end(body);
        return;
      }
      sendJson(response, 404, { error: "not found" });
    } catch {
      sendJson(response, 500, { error: "synthetic fixture failure" });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const rawBody = JSON.stringify(sample.webhook);
    const signature = createHmac("sha256", "synthetic-local-signing-key").update(rawBody).digest("hex");
    const postWebhook = () => fetch(`${baseUrl}/webhooks/karbon`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Signature: signature },
      body: rawBody,
    });
    const webhook1 = await postWebhook();
    const first = await webhook1.json();
    const webhook2 = await postWebhook();
    const second = await webhook2.json();

    let identityDecision = "NOT_PROCESSED";
    let contactCreateStatus = null;
    for (const event of queue) {
      const fullRecord = await fetchKarbonContact({
        resourcePermaKey: event.ResourcePermaKey,
        accessToken: "synthetic-local-token",
        accessKey: "synthetic-local-access-key",
        baseUrl,
      });
      const contact = normalizeContact(fullRecord);
      const identity = resolveIdentity(contact, []);
      identityDecision = identity.action;
      if (identity.action !== "CREATE") continue;
      const entryXml = buildSharedContactAtomEntry(contact);
      const created = await createGoogleSharedContact({
        collectionUrl: `${baseUrl}/google/contacts/example.test/full`,
        accessToken: "synthetic-local-token",
        entryXml,
      });
      contactCreateStatus = created.status;
    }
    return {
      webhookAccepted: first.accepted,
      webhookDuplicates: second.duplicates,
      fullRecordFetches: stats.fullRecordFetches,
      identityDecision,
      contactCreateStatus,
      logicalWrites: stats.logicalWrites,
      externalCalls: stats.externalCalls,
    };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runDemo();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
