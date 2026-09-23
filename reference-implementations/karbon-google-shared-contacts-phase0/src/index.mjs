import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const ATOM = "http://www.w3.org/2005/Atom";
const GD = "http://schemas.google.com/g/2005";
const CONTACT_KIND = "http://schemas.google.com/contact/2008#contact";
const KARBON_ID_PROPERTY = "com.example.karbonId";

export function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

// Deliberately does not infer a country code from a local number.
export function normalizeE164Phone(value) {
  if (typeof value !== "string") return null;
  const compact = value.trim().replace(/[\s().-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null;
}

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeContact(record = {}) {
  const karbonId = asText(record.karbonId ?? record.ResourcePermaKey ?? record.ContactKey);
  const name = asText(record.name ?? record.FullName ?? record.fullName);
  const rawEmail = asText(record.email ?? record.EmailAddress);
  const rawPhone = asText(record.phone ?? record.PhoneNumber);
  const email = rawEmail ? normalizeEmail(rawEmail) : null;
  const phone = rawPhone ? normalizeE164Phone(rawPhone) : null;
  const invalidFields = [];
  if (!karbonId) invalidFields.push("karbonId");
  if (!name) invalidFields.push("name");
  if (rawEmail && !email) invalidFields.push("email");
  if (rawPhone && !phone) invalidFields.push("phone");
  return {
    karbonId,
    name,
    email,
    phone,
    address: record.address ?? record.addresses ?? null,
    invalidFields,
  };
}

function identifiers(record) {
  const contact = normalizeContact(record);
  return { karbonId: contact.karbonId, email: contact.email, phone: contact.phone };
}

export function resolveIdentity(incomingRecord, existingRecords = []) {
  const incoming = normalizeContact(incomingRecord);
  if (incoming.invalidFields.some((field) => field === "name" || field === "karbonId" || field === "email" || field === "phone")) {
    return { action: "HUMAN_REVIEW", reason: "INVALID_SOURCE_FIELD", fields: incoming.invalidFields };
  }

  const keys = ["karbonId", "email", "phone"];
  const matches = Object.fromEntries(keys.map((key) => [key, incoming[key]
    ? existingRecords.filter((record) => identifiers(record)[key] === incoming[key])
    : []]));

  for (const key of keys) {
    if (matches[key].length > 1) {
      return { action: "HUMAN_REVIEW", reason: "DUPLICATE_IDENTIFIER", identifier: key };
    }
  }

  const candidateIds = new Set(keys.flatMap((key) => matches[key].map((record) => asText(record.karbonId ?? record.ContactKey))));
  if (candidateIds.size > 1) {
    return { action: "HUMAN_REVIEW", reason: "CONFLICTING_IDENTIFIERS" };
  }

  const matchedBy = keys.find((key) => matches[key].length === 1);
  if (matchedBy) {
    return { action: "UPDATE", matchedBy, record: matches[matchedBy][0] };
  }

  if (!incoming.email && !incoming.phone) {
    return { action: "HUMAN_REVIEW", reason: "NO_MATCH_KEYS" };
  }
  return { action: "CREATE" };
}

function canonicalEvent(event) {
  return {
    ResourcePermaKey: event.ResourcePermaKey,
    ResourceType: event.ResourceType,
    ActionType: event.ActionType,
    Timestamp: event.TimeStamp ?? event.Timestamp,
  };
}

export function normalizeKarbonWebhookEvents(payload) {
  const rawEvents = Array.isArray(payload?.Events) ? payload.Events : [payload];
  if (rawEvents.length === 0) throw new Error("Webhook contains no events");
  return rawEvents.map((raw) => {
    const event = canonicalEvent(raw ?? {});
    if (!["ResourcePermaKey", "ResourceType", "ActionType", "Timestamp"].every((key) => asText(event[key]))) {
      throw new Error("Webhook is missing a required event field");
    }
    const eventId = createHash("sha256").update(JSON.stringify(event)).digest("hex");
    return { ...event, eventId };
  });
}

export function verifyKarbonSignature(rawBody, signature, signingKey) {
  if (!signingKey || !signature) return false;
  const expected = createHmac("sha256", signingKey).update(rawBody).digest("hex");
  const actual = String(signature).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(actual)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
}

export class WebhookInbox {
  #seen = new Set();

  constructor(enqueueDurably) {
    if (typeof enqueueDurably !== "function") throw new TypeError("enqueueDurably must be a function");
    this.enqueueDurably = enqueueDurably;
  }

  async accept({ rawBody, signature, signingKey }) {
    if (!verifyKarbonSignature(rawBody, signature, signingKey)) {
      return { status: 401, accepted: 0, reason: "INVALID_SIGNATURE" };
    }
    let payload;
    try {
      payload = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody));
    } catch {
      return { status: 400, accepted: 0, reason: "INVALID_JSON" };
    }
    let events;
    try {
      events = normalizeKarbonWebhookEvents(payload);
    } catch {
      return { status: 400, accepted: 0, reason: "INVALID_EVENT" };
    }

    let accepted = 0;
    let duplicates = 0;
    for (const event of events) {
      if (this.#seen.has(event.eventId)) {
        duplicates += 1;
        continue;
      }
      // Production adapter must make this enqueue durable/idempotent before returning 2xx.
      await this.enqueueDurably(event);
      this.#seen.add(event.eventId);
      accepted += 1;
    }
    return { status: 202, accepted, duplicates };
  }
}

export async function requestWithKarbonRetry(request, {
  maxAttempts = 5,
  baseDelayMs = 250,
  maxBackoffMs = 8_000,
  maxInlineRetryAfterMs = 30_000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await request();
      if (response.status !== 429) {
        if (!response.ok) throw Object.assign(new Error(`Karbon HTTP ${response.status}`), { status: response.status });
        return response;
      }
      const retryAfterSeconds = Number(response.headers?.get?.("Retry-After"));
      const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0 ? retryAfterSeconds * 1000 : 0;
      if (retryAfterMs > maxInlineRetryAfterMs) {
        throw Object.assign(new Error("Karbon retry deferred to the durable scheduler"), {
          code: "RATE_LIMIT_DEFERRED",
          retryAfterMs,
        });
      }
      const exponentialMs = Math.min(maxBackoffMs, baseDelayMs * (2 ** attempt));
      lastError = Object.assign(new Error("Karbon rate limit (429)"), { status: 429 });
      if (attempt + 1 < maxAttempts) await sleep(Math.max(retryAfterMs, exponentialMs));
    } catch (error) {
      const retryableNetworkError = error?.name === "AbortError" || error?.name === "TimeoutError" || error?.retryable === true;
      if (error.status !== 429 && !retryableNetworkError) throw error;
      lastError = error;
      const exponentialMs = Math.min(maxBackoffMs, baseDelayMs * (2 ** attempt));
      if (attempt + 1 < maxAttempts) await sleep(exponentialMs);
    }
  }
  throw lastError ?? new Error("Karbon retry attempts exhausted");
}

export async function fetchKarbonContact({
  resourcePermaKey,
  fetchImpl = fetch,
  accessToken,
  accessKey,
  baseUrl = "https://api.karbonhq.com",
  retryOptions = {},
}) {
  if (!asText(resourcePermaKey)) throw new TypeError("resourcePermaKey is required");
  if (!accessToken || !accessKey) throw new Error("Karbon credentials must be supplied by a secure runtime adapter");
  const url = `${baseUrl}/v3/Contacts/${encodeURIComponent(resourcePermaKey)}`;
  const response = await requestWithKarbonRetry(
    () => fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}`, AccessKey: accessKey, Accept: "application/json" } }),
    retryOptions,
  );
  return response.json();
}

function escapeXml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function addressFields(value) {
  if (!value || typeof value !== "object") return null;
  const result = {
    street: asText(value.street ?? value.streetAddress),
    city: asText(value.city),
    region: asText(value.region ?? value.state),
    postcode: asText(value.postcode ?? value.postalCode),
    country: asText(value.country),
    formatted: asText(value.formattedAddress),
  };
  return Object.values(result).some(Boolean) ? result : null;
}

function nameXml(name) {
  const parts = name.split(/\s+/).filter(Boolean);
  const given = parts.shift() ?? "";
  const family = parts.join(" ");
  return `<gd:name><gd:givenName>${escapeXml(given)}</gd:givenName><gd:familyName>${escapeXml(family)}</gd:familyName><gd:fullName>${escapeXml(name)}</gd:fullName></gd:name>`;
}

function fieldXml(contact) {
  const fields = [];
  fields.push(nameXml(contact.name));
  if (contact.email) fields.push(`<gd:email rel="${GD}#work" primary="true" address="${escapeXml(contact.email)}"/>`);
  if (contact.phone) fields.push(`<gd:phoneNumber rel="${GD}#work" primary="true">${escapeXml(contact.phone)}</gd:phoneNumber>`);
  const address = addressFields(contact.address);
  if (address) {
    fields.push(`<gd:structuredPostalAddress rel="${GD}#work" primary="true"><gd:street>${escapeXml(address.street)}</gd:street><gd:city>${escapeXml(address.city)}</gd:city><gd:region>${escapeXml(address.region)}</gd:region><gd:postcode>${escapeXml(address.postcode)}</gd:postcode><gd:country>${escapeXml(address.country)}</gd:country><gd:formattedAddress>${escapeXml(address.formatted)}</gd:formattedAddress></gd:structuredPostalAddress>`);
  }
  fields.push(`<gd:extendedProperty name="${KARBON_ID_PROPERTY}" value="${escapeXml(contact.karbonId)}"/>`);
  return fields;
}

export function buildSharedContactAtomEntry(sourceRecord) {
  const contact = normalizeContact(sourceRecord);
  if (!contact.karbonId || !contact.name || contact.invalidFields.length) {
    throw new Error(`Contact cannot be serialized: ${contact.invalidFields.join(",") || "invalid fields"}`);
  }
  const category = `<atom:category scheme="${GD}#kind" term="${CONTACT_KIND}"/>`;
  return `<atom:entry xmlns:atom="${ATOM}" xmlns:gd="${GD}">${category}${fieldXml(contact).join("")}</atom:entry>`;
}

export async function createGoogleSharedContact({ collectionUrl, accessToken, entryXml, fetchImpl = fetch }) {
  if (!collectionUrl || !accessToken) throw new Error("Google collection URL and OAuth access token are required");
  if (!isWellFormedXml(entryXml)) throw new Error("Shared contact Atom/XML payload is malformed");
  const response = await fetchImpl(collectionUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/atom+xml",
      "GData-Version": "3.0",
    },
    body: entryXml,
  });
  if (!response.ok) throw Object.assign(new Error(`Google Shared Contacts HTTP ${response.status}`), { status: response.status });
  return { status: response.status, body: await response.text() };
}

function decodeXml(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
    if (entity === "amp") return "&";
    if (entity === "lt") return "<";
    if (entity === "gt") return ">";
    if (entity === "quot") return '"';
    if (entity === "apos") return "'";
    const codePoint = entity.toLowerCase().startsWith("#x") ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    return String.fromCodePoint(codePoint);
  });
}

function parseAttributes(source) {
  const attrs = {};
  const pattern = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/gy;
  let cursor = 0;
  while (cursor < source.length) {
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    if (cursor >= source.length) break;
    pattern.lastIndex = cursor;
    const match = pattern.exec(source);
    if (!match) throw new Error("Malformed XML attributes");
    attrs[match[1]] = decodeXml(match[3] ?? match[4] ?? "");
    cursor = pattern.lastIndex;
  }
  return attrs;
}

function localName(qualifiedName) {
  return qualifiedName.split(":").at(-1);
}

function parseXmlTree(xml) {
  if (typeof xml !== "string" || !xml.trim()) throw new Error("XML is empty");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("DTD and entity declarations are not accepted");
  const tokens = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>/g;
  const stack = [];
  const roots = [];
  let cursor = 0;
  let match;
  while ((match = tokens.exec(xml))) {
    const text = xml.slice(cursor, match.index);
    if (text.includes("<") || /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/i.test(text)) throw new Error("Malformed XML text");
    const token = match[0];
    cursor = tokens.lastIndex;
    if (token.startsWith("<!--") || token.startsWith("<![CDATA[")) continue;
    if (token.startsWith("<?")) {
      if (match.index !== 0) throw new Error("XML declaration must be first");
      continue;
    }
    if (token.startsWith("</")) {
      const closing = token.match(/^<\/([A-Za-z_][\w:.-]*)\s*>$/);
      if (!closing || stack.length === 0 || stack.at(-1).name !== closing[1]) throw new Error("Mismatched XML closing tag");
      const node = stack.pop();
      node.closeStart = match.index;
      node.end = tokens.lastIndex;
      continue;
    }
    const opening = token.match(/^<([A-Za-z_][\w:.-]*)([\s\S]*?)>$/);
    if (!opening) throw new Error("Malformed XML tag");
    let attrSource = opening[2];
    const selfClosing = /\/\s*$/.test(attrSource);
    if (selfClosing) attrSource = attrSource.replace(/\/\s*$/, "");
    const attrs = parseAttributes(attrSource);
    const node = { name: opening[1], localName: localName(opening[1]), attrs, start: match.index, openEnd: tokens.lastIndex, closeStart: null, end: selfClosing ? tokens.lastIndex : null, children: [], parent: stack.at(-1) ?? null, selfClosing };
    if (node.parent) node.parent.children.push(node);
    else roots.push(node);
    if (!selfClosing) stack.push(node);
  }
  const tail = xml.slice(cursor);
  if (tail.includes("<") || /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/i.test(tail)) throw new Error("Malformed XML tail");
  if (stack.length || roots.length !== 1) throw new Error("XML must have one balanced root element");
  return { xml, root: roots[0] };
}

export function isWellFormedXml(xml) {
  try {
    parseXmlTree(xml);
    return true;
  } catch {
    return false;
  }
}

function childText(xml, node) {
  return decodeXml(xml.slice(node.openEnd, node.closeStart ?? node.openEnd).replace(/<[^>]*>/g, "").trim());
}

function editMetadata(tree) {
  if (tree.root.localName !== "entry") throw new Error("Expected an Atom entry");
  const idNode = tree.root.children.find((node) => node.localName === "id");
  const editNode = tree.root.children.find((node) => node.localName === "link" && node.attrs.rel === "edit");
  if (!idNode || !editNode?.attrs.href) throw new Error("Entry must include id and edit link");
  return { id: childText(tree.xml, idNode), editUrl: editNode.attrs.href };
}

function replaceManagedNodes(tree, desiredContact) {
  const replacements = [];
  const additions = [];
  const nodes = tree.root.children;
  const contact = normalizeContact(desiredContact);
  if (!contact.karbonId || !contact.name || contact.invalidFields.length) throw new Error("Desired contact is invalid");

  const managed = [
    { local: "name", xml: nameXml(contact.name) },
    ...(contact.email ? [{ local: "email", xml: `<gd:email rel="${GD}#work" primary="true" address="${escapeXml(contact.email)}"/>`, predicate: (node) => node.attrs.primary === "true" && (node.attrs.rel ?? "").endsWith("#work") }] : []),
    ...(contact.phone ? [{ local: "phoneNumber", xml: `<gd:phoneNumber rel="${GD}#work" primary="true">${escapeXml(contact.phone)}</gd:phoneNumber>`, predicate: (node) => node.attrs.primary === "true" && (node.attrs.rel ?? "").endsWith("#work") }] : []),
    ...(addressFields(contact.address) ? [{ local: "structuredPostalAddress", xml: fieldXml(contact).find((field) => field.startsWith("<gd:structuredPostalAddress")), predicate: (node) => node.attrs.primary === "true" && (node.attrs.rel ?? "").endsWith("#work") }] : []),
    { local: "extendedProperty", property: KARBON_ID_PROPERTY, xml: `<gd:extendedProperty name="${KARBON_ID_PROPERTY}" value="${escapeXml(contact.karbonId)}"/>`, predicate: (node) => node.attrs.name === KARBON_ID_PROPERTY },
  ];

  for (const spec of managed) {
    const candidates = nodes.filter((node) => node.localName === spec.local && (!spec.predicate || spec.predicate(node)));
    if (spec.local === "extendedProperty" && candidates.length > 1) throw new Error("Duplicate Karbon ID extended properties require review");
    if (["email", "phoneNumber", "structuredPostalAddress"].includes(spec.local) && candidates.length > 1) throw new Error(`Multiple primary ${spec.local} fields require review`);
    if (candidates[0]) replacements.push({ start: candidates[0].start, end: candidates[0].end, text: spec.xml });
    else additions.push(spec.xml);
  }

  let output = tree.xml;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, replacement.start) + replacement.text + output.slice(replacement.end);
  }
  if (additions.length) {
    const root = parseXmlTree(output).root;
    const closingStart = root.closeStart;
    if (closingStart == null) throw new Error("Entry is not closed");
    output = output.slice(0, closingStart) + additions.join("") + output.slice(closingStart);
  }
  return output;
}

export function prepareVersionedSharedContactUpdate({ currentEntryXml, desiredContact, latestEditUrl }) {
  const tree = parseXmlTree(currentEntryXml);
  const metadata = editMetadata(tree);
  if (!metadata.editUrl.match(/\/[^/]+\/\d+\/?$/)) throw new Error("Edit URL must include a version segment");
  if (latestEditUrl && latestEditUrl !== metadata.editUrl) {
    return { status: "CONFLICT", httpStatus: 409, reason: "STALE_EDIT_URL", latestEditUrl };
  }
  const body = replaceManagedNodes(tree, desiredContact);
  return {
    status: "READY",
    method: "PUT",
    url: metadata.editUrl,
    headers: { "Content-Type": "application/atom+xml", "GData-Version": "3.0" },
    id: metadata.id,
    body,
  };
}

export async function executeVersionedUpdate(plan, latestEditUrl, put) {
  if (plan.status !== "READY") return plan;
  if (latestEditUrl !== plan.url) return { status: "CONFLICT", httpStatus: 409, reason: "STALE_EDIT_URL" };
  const response = await put(plan);
  if (response.status === 409) return { status: "CONFLICT", httpStatus: 409, reason: "SERVER_VERSION_CONFLICT", currentEntry: response.currentEntry ?? null };
  if (!response.ok) return { status: "FAILED", httpStatus: response.status };
  return { status: "UPDATED", httpStatus: response.status, entry: response.entry ?? null };
}

export class IdempotentSyntheticWriter {
  constructor() {
    this.entries = new Map();
    this.results = new Map();
    this.logicalWrites = 0;
  }

  async write({ idempotencyKey, contact }) {
    if (this.results.has(idempotencyKey)) return { ...this.results.get(idempotencyKey), replayed: true };
    const existing = this.entries.get(contact.karbonId);
    const result = { action: existing ? "updated" : "created", karbonId: contact.karbonId, replayed: false };
    this.entries.set(contact.karbonId, structuredClone(contact));
    this.results.set(idempotencyKey, result);
    this.logicalWrites += 1;
    return result;
  }
}

export async function writeWithReplaySafety(writer, payload, { maxAttempts = 2, afterCommit = null } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const result = await writer.write(payload);
      if (attempt === 0 && afterCommit) await afterCommit(result);
      return result;
    } catch (error) {
      if (!error.responseLost || attempt + 1 >= maxAttempts) throw error;
    }
  }
  throw new Error("Write retry exhausted");
}

export async function scanPaged({ fetchPage, checkpointStore, checkpointKey, applyPage = async () => [] }) {
  let cursor = await checkpointStore.get(checkpointKey);
  const output = [];
  do {
    const page = await fetchPage(cursor);
    if (!Array.isArray(page.items)) throw new Error("Page items must be an array");
    const pageResult = await applyPage(page.items);
    output.push(...(Array.isArray(pageResult) ? pageResult : []));
    // Advance only after the whole page is handled; replay is safe because writes are idempotent.
    cursor = page.nextPageToken ?? null;
    await checkpointStore.set(checkpointKey, cursor);
  } while (cursor !== null);
  return output;
}

export function buildReconciliationReport(karbonContacts, googleContacts, { failed = [] } = {}) {
  const report = { created: [], updated: [], unchanged: [], conflict: [], failed: [...failed], manualReview: [] };
  for (const source of karbonContacts) {
    const resolution = resolveIdentity(source, googleContacts);
    if (resolution.action === "HUMAN_REVIEW") {
      if (resolution.reason === "CONFLICTING_IDENTIFIERS") {
        report.conflict.push(source.karbonId);
        continue;
      }
      report.manualReview.push({ karbonId: source.karbonId, reason: resolution.reason });
      continue;
    }
    if (resolution.action === "CREATE") {
      report.created.push(source.karbonId);
      continue;
    }
    if (resolution.reason === "CONFLICTING_IDENTIFIERS") {
      report.conflict.push(source.karbonId);
      continue;
    }
    const sourceNormalized = normalizeContact(source);
    const targetNormalized = normalizeContact(resolution.record);
    const equal = ["name", "email", "phone"].every((key) => sourceNormalized[key] === targetNormalized[key]);
    report[equal ? "unchanged" : "updated"].push(source.karbonId);
  }
  return report;
}
