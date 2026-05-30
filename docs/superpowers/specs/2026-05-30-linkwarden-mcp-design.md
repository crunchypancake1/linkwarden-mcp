# Linkwarden MCP Worker — Design Spec
_2026-05-30_

## Overview

A single Cloudflare Worker that replaces the existing Docker-hosted Linkwarden MCP container. It exposes a minimal MCP tool surface via `McpAgent` and runs a cron-driven indexer that pushes selected Linkwarden collections into a new Cloudflare AI Search instance.

**Constraints confirmed during design:**
- Existing Cloudflare account with other Workers/KV; this is a new Worker wired into that account
- AI Search instance does not yet exist — created as part of this project
- KV used for collection config + per-collection indexed-item-ID sets (no D1)
- Single Worker deployment (MCP + cron in one `wrangler.jsonc`)
- Linkwarden API uses cursor-based pagination (`nextCursor`); no timestamp filtering — full re-scans per run, idempotent upserts

---

## 1. Project Structure

```
linkwarden-mcp/
├── wrangler.jsonc
├── src/
│   ├── index.ts                  # Worker entry point
│   ├── mcp/
│   │   ├── agent.ts              # LinkwardenMCP extends McpAgent
│   │   └── tools/
│   │       ├── links.ts          # search_links, get_link, create_link, archive_link
│   │       ├── collections.ts    # list_collections, get_indexed_collections, set_indexed_collections
│   │       └── tags.ts           # list_tags
│   ├── indexer/
│   │   ├── cron.ts               # scheduled() handler
│   │   ├── sync.ts               # per-collection fetch → normalize → upsert
│   │   └── reconcile.ts          # purge items for deselected collections
│   ├── sink/
│   │   └── ai-search.ts          # SearchSink backed by Cloudflare AI Search
│   ├── linkwarden/
│   │   └── api.ts                # typed Linkwarden API client
│   └── types.ts                  # NormalizedDoc, SearchSink, Env, CollectionConfig
```

---

## 2. Configuration (`wrangler.jsonc`)

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "linkwarden-mcp",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-30",
  "compatibility_flags": ["nodejs_compat"],
  "durable_objects": {
    "bindings": [{ "name": "LINKWARDEN_MCP", "class_name": "LinkwardenMCP" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["LinkwardenMCP"] }],
  "kv_namespaces": [
    { "binding": "KV", "id": "<kv-namespace-id>" }
  ],
  "r2_buckets": [
    { "binding": "R2_SEARCH", "bucket_name": "linkwarden-search" }
  ],
  "ai": { "binding": "AI" },
  "triggers": {
    "crons": ["0 * * * *"]
  }
}
```

**Notes on bindings:**
- `McpAgent` is a Durable Object — requires `durable_objects` + `migrations` entries with `new_sqlite_classes`
- AI Search (AutoRAG) ingests content from R2; there is no direct push API. The sink writes text files to `R2_SEARCH`, and the AutoRAG instance is configured in the Cloudflare dashboard to index that bucket
- `AI` binding is the standard Workers AI binding used to query the AutoRAG index

**Secrets** (via `wrangler secret put`):
- `LINKWARDEN_URL` — base URL of the Linkwarden instance
- `LINKWARDEN_TOKEN` — API bearer token

**Auth:** Worker deployed without built-in auth; `/mcp` endpoint protected via Cloudflare Access. No auth logic in Worker code.

---

## 3. Env Type

```ts
interface Env {
  LINKWARDEN_MCP: DurableObjectNamespace;
  KV: KVNamespace;
  R2_SEARCH: R2Bucket;
  AI: Ai;
  LINKWARDEN_URL: string;
  LINKWARDEN_TOKEN: string;
}
```

---

## 4. Worker Entry Point (`src/index.ts`)

```ts
import { LinkwardenMCP } from "./mcp/agent";
import { runScheduled } from "./indexer/cron";

export { LinkwardenMCP };

export default {
  fetch: LinkwardenMCP.mount("/mcp"),
  scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduled(env));
  },
};
```

---

## 5. MCP Tools

All tools are registered in `LinkwardenMCP.init()` and call the typed Linkwarden API client. Zod schemas enforce inputs.

| Tool | Method | Linkwarden endpoint |
|------|--------|---------------------|
| `search_links` | GET | `/api/v1/search` |
| `get_link` | GET | `/api/v1/links/:id` |
| `create_link` | POST | `/api/v1/links` |
| `archive_link` | PUT | `/api/v1/links/:id/archive` |
| `list_collections` | GET | `/api/v1/collections` |
| `list_tags` | GET | `/api/v1/tags` |
| `get_indexed_collections` | — | reads KV key `config:indexed-collections` |
| `set_indexed_collections` | — | writes KV key `config:indexed-collections`, triggers reconcile |

**`search_links` input schema:**
```ts
{
  query?: string;
  collectionId?: number;
  tagName?: string;
  cursor?: string;
}
```

**`create_link` input schema:**
```ts
{
  url: string;
  name?: string;
  description?: string;
  collectionId?: number;
  tags?: string[];
}
```

**`get_indexed_collections` / `set_indexed_collections`:**
- KV key: `config:indexed-collections`
- Value shape: `{ mode: "allowlist", collectionIds: number[] }`
- `set_indexed_collections` writes the new config then immediately calls `reconcile()` to purge any deselected collections

---

## 6. Linkwarden API Client (`src/linkwarden/api.ts`)

Thin typed fetch wrapper. All requests attach `Authorization: Bearer <token>`. Handles cursor pagination transparently for callers that need full collection sweeps.

```ts
class LinkwardenClient {
  async searchLinks(params: SearchParams): Promise<LinkPage>
  async getLink(id: number): Promise<Link>
  async createLink(body: CreateLinkBody): Promise<Link>
  async archiveLink(id: number): Promise<void>
  async getCollections(): Promise<Collection[]>
  async getTags(): Promise<Tag[]>
  // Internal: pages through all links in a collection via nextCursor
  async *allLinksForCollection(collectionId: number): AsyncGenerator<Link>
}
```

`allLinksForCollection` is the generator used by the indexer — it pages through `/api/v1/search?collectionId=X&cursor=Y` until `nextCursor` is null.

---

## 7. Normalized Document & Sink Interface

```ts
interface NormalizedDoc {
  id: string;          // "linkwarden:123"
  source: "linkwarden";
  title: string;
  url?: string;
  content: string;     // description ?? name — archived text field TBD against live instance
  metadata: {
    collection?: string;
    tags?: string[];
    createdAt?: string;
    updatedAt?: string;
  };
}

interface SearchSink {
  upsert(docs: NormalizedDoc[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
}
```

**Content field:** Use `link.description` as primary content for embedding; fall back to `link.name`. If the live Linkwarden instance exposes an archived/readable text field (e.g. from SingleFile), swap it in — the `NormalizedDoc` shape and sink interface are unaffected.

---

## 8. R2 Search Sink (`src/sink/r2-search.ts`)

AI Search (AutoRAG) ingests from R2 — there is no direct document push API. The sink writes each `NormalizedDoc` as a plain-text file into the R2 bucket that the AutoRAG instance monitors. Deletion removes the corresponding R2 object, which AutoRAG drops from its index on the next re-index cycle.

R2 key pattern: `linkwarden/{linkId}.txt` (derived from doc ID `linkwarden:{linkId}`).

```ts
class R2SearchSink implements SearchSink {
  constructor(private bucket: R2Bucket) {}

  async upsert(docs: NormalizedDoc[]): Promise<void> {
    await Promise.all(docs.map(doc =>
      this.bucket.put(this.r2Key(doc.id), this.serialize(doc), {
        httpMetadata: { contentType: "text/plain" },
      })
    ));
  }

  async remove(ids: string[]): Promise<void> {
    await Promise.all(ids.map(id => this.bucket.delete(this.r2Key(id))));
  }

  private r2Key(docId: string): string {
    // "linkwarden:123" → "linkwarden/123.txt"
    return `linkwarden/${docId.split(":")[1]}.txt`;
  }

  private serialize(doc: NormalizedDoc): string {
    return [
      `Title: ${doc.title}`,
      `URL: ${doc.url ?? ""}`,
      `Collection: ${doc.metadata.collection ?? ""}`,
      `Tags: ${(doc.metadata.tags ?? []).join(", ")}`,
      ``,
      doc.content,
    ].join("\n");
  }
}
```

**AutoRAG setup (dashboard):** Create a new AutoRAG instance named `linkwarden`, point its data source at the `linkwarden-search` R2 bucket. Querying via `env.AI.autorag("linkwarden").search({ query })` in any future search tool.

---

## 9. Indexer — Cron Handler & Sync Logic

### `cron.ts` — `runScheduled(env)`
1. Load `config:indexed-collections` from KV
2. For each `collectionId` in the allowlist, call `syncCollection(collectionId, env)`
3. Run reconciliation to purge items for any collections no longer in the allowlist

### `sync.ts` — `syncCollection(collectionId, env)`
1. Fetch all links for the collection via `client.allLinksForCollection(collectionId)` (cursor-paginated)
2. Build a `NormalizedDoc[]` from the links
3. `sink.upsert(docs)` — idempotent; AI Search handles dedup by ID
4. Write the set of upserted IDs to KV: key `indexed-ids:<collectionId>`, value `JSON.stringify(ids)`

### `reconcile.ts` — `reconcile(currentAllowlist, env)`
1. Enumerate all `indexed-ids:<collectionId>` keys in KV
2. For any `collectionId` not in `currentAllowlist`, call `sink.remove(ids)` then delete the KV key

---

## 10. KV Key Schema

| Key | Value | Purpose |
|-----|-------|---------|
| `config:indexed-collections` | `{"mode":"allowlist","collectionIds":[1,5]}` | Which collections to index |
| `indexed-ids:<collectionId>` | `["linkwarden:1","linkwarden:42",...]` | Item IDs indexed for that collection (used for reconciliation) |

---

## 11. Error Handling

- Linkwarden API errors: log and surface as MCP tool errors with the HTTP status. Do not retry in the MCP path (client can retry).
- Cron indexer: per-collection errors are caught and logged; other collections continue. A failed sync does not corrupt KV state (IDs only written after successful upsert).
- AI Search errors: propagate up to the cron handler, log, and let Cloudflare retry on next cron tick.

---

## 12. Deployment Steps (post-implementation)

1. `wrangler kv namespace create linkwarden-mcp` → paste ID into `wrangler.jsonc`
2. `wrangler r2 bucket create linkwarden-search`
3. In Cloudflare dashboard: create AutoRAG instance named `linkwarden`, data source = `linkwarden-search` R2 bucket
4. `wrangler secret put LINKWARDEN_URL` + `wrangler secret put LINKWARDEN_TOKEN`
5. `wrangler deploy`
6. Apply Cloudflare Access policy to `<worker-url>/mcp`
7. Update AI Controls connector URL to the new Worker
8. Decommission Docker MCP container

---

## Open Items (resolve at implementation time)

- Confirm which Linkwarden link field carries archived/readable text (test against live instance; swap into `NormalizedDoc.content` if available)
- Confirm `collectionId` is a valid filter param on `/api/v1/search` (test against live instance — fall back to client-side filter if not)
