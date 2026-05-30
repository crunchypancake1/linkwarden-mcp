# Linkwarden MCP Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Cloudflare Worker that replaces the Docker-hosted Linkwarden MCP container, exposing MCP tools via `McpAgent` and indexing selected collections into Cloudflare AI Search via an R2-backed cron adapter.

**Architecture:** Single Worker project with `McpAgent` (Durable Object) for the `/mcp` endpoint and a `scheduled()` cron handler for the indexer. Content is written as text files to an R2 bucket that an AutoRAG instance monitors. KV stores the indexed-collections config and per-collection item ID sets for reconciliation.

**Tech Stack:** Cloudflare Workers (TypeScript), `agents` npm package (`McpAgent`), `@modelcontextprotocol/sdk`, `zod`, Cloudflare R2, Cloudflare AI (AutoRAG), Cloudflare KV, `vitest`

---

## File Map

| File | Responsibility |
|------|---------------|
| `wrangler.jsonc` | Worker config: DO bindings, KV, R2, AI, cron trigger |
| `tsconfig.json` | TypeScript config |
| `src/types.ts` | `Env`, `NormalizedDoc`, `SearchSink`, `CollectionConfig`, `Link`, `Collection`, `Tag` |
| `src/linkwarden/api.ts` | Typed Linkwarden API client with cursor pagination |
| `src/sink/r2-search.ts` | `R2SearchSink implements SearchSink` — writes/deletes R2 objects |
| `src/indexer/sync.ts` | `syncCollection()` — fetches all links in a collection, upserts to sink, writes IDs to KV |
| `src/indexer/reconcile.ts` | `reconcile()` — purges R2 objects for deselected collections |
| `src/indexer/cron.ts` | `runScheduled()` — orchestrates sync + reconcile per cron tick |
| `src/mcp/tools/links.ts` | `registerLinkTools()` — `search_links`, `get_link`, `create_link`, `archive_link` |
| `src/mcp/tools/collections.ts` | `registerCollectionTools()` — `list_collections`, `get_indexed_collections`, `set_indexed_collections` |
| `src/mcp/tools/tags.ts` | `registerTagTools()` — `list_tags` |
| `src/mcp/agent.ts` | `LinkwardenMCP extends McpAgent` — registers all tools in `init()` |
| `src/index.ts` | Worker entry point — exports `LinkwardenMCP` + default with `fetch` + `scheduled` |
| `test/linkwarden-api.test.ts` | Unit tests for `LinkwardenClient` |
| `test/r2-search-sink.test.ts` | Unit tests for `R2SearchSink` |
| `test/sync.test.ts` | Unit tests for `syncCollection` |
| `test/reconcile.test.ts` | Unit tests for `reconcile` |

---

## Task 1: Scaffold project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `wrangler.jsonc`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/types.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "linkwarden-mcp",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "agents": "^0.0.95",
    "@modelcontextprotocol/sdk": "^1.12.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250525.0",
    "typescript": "^5.8.3",
    "vitest": "^3.1.0",
    "wrangler": "^4.14.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `wrangler.jsonc`**

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "linkwarden-mcp",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-30",
  "compatibility_flags": ["nodejs_compat"],
  "durable_objects": {
    "bindings": [
      { "name": "LINKWARDEN_MCP", "class_name": "LinkwardenMCP" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["LinkwardenMCP"] }
  ],
  "kv_namespaces": [
    { "binding": "KV", "id": "REPLACE_WITH_KV_ID", "preview_id": "REPLACE_WITH_KV_PREVIEW_ID" }
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

- [ ] **Step 4: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 5: Create `.gitignore`**

```
node_modules/
dist/
.wrangler/
*.env
```

- [ ] **Step 6: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 7: Create `src/types.ts`**

```typescript
export interface Env {
  LINKWARDEN_MCP: DurableObjectNamespace;
  KV: KVNamespace;
  R2_SEARCH: R2Bucket;
  AI: Ai;
  LINKWARDEN_URL: string;
  LINKWARDEN_TOKEN: string;
}

export interface CollectionConfig {
  mode: "allowlist";
  collectionIds: number[];
}

export const INDEXED_COLLECTIONS_KEY = "config:indexed-collections";
export const INDEXED_IDS_PREFIX = "indexed-ids:";

export interface NormalizedDoc {
  id: string;       // "linkwarden:123"
  source: "linkwarden";
  title: string;
  url?: string;
  content: string;
  metadata: {
    collection?: string;
    tags?: string[];
    createdAt?: string;
    updatedAt?: string;
  };
}

export interface SearchSink {
  upsert(docs: NormalizedDoc[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
}

export interface LinkTag {
  id: number;
  name: string;
}

export interface Link {
  id: number;
  name: string;
  url: string;
  description?: string;
  collectionId?: number;
  collection?: { id: number; name: string };
  tags?: LinkTag[];
  createdAt?: string;
  updatedAt?: string;
}

export interface LinkPage {
  links: Link[];
  nextCursor: number | null;
}

export interface Collection {
  id: number;
  name: string;
  description?: string;
}

export interface Tag {
  id: number;
  name: string;
}

export interface SearchParams {
  searchQueryString?: string;
  collectionId?: number;
  tagName?: string;
  cursor?: number;
}
```

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json wrangler.jsonc vitest.config.ts .gitignore src/types.ts
git commit -m "chore: scaffold project — wrangler config, types, dev dependencies"
```

---

## Task 2: Linkwarden API client

**Files:**
- Create: `src/linkwarden/api.ts`
- Create: `test/linkwarden-api.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/linkwarden-api.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinkwardenClient } from "../src/linkwarden/api";
import type { Link, LinkPage, Collection, Tag } from "../src/types";

const BASE_URL = "https://lw.example.com";
const TOKEN = "tok-test";

function makeLink(id: number, extras: Partial<Link> = {}): Link {
  return { id, name: `Link ${id}`, url: `https://example.com/${id}`, ...extras };
}

describe("LinkwardenClient", () => {
  let client: LinkwardenClient;

  beforeEach(() => {
    client = new LinkwardenClient(BASE_URL, TOKEN);
    vi.restoreAllMocks();
  });

  it("searchLinks attaches bearer token and query params", async () => {
    const page: LinkPage = { links: [makeLink(1)], nextCursor: null };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ response: page.links, nextCursor: null }), { status: 200 })
    );

    const result = await client.searchLinks({ searchQueryString: "test", collectionId: 5 });

    const [url, init] = (fetch as ReturnType<typeof vi.spyOn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/search");
    expect(url).toContain("searchQueryString=test");
    expect(url).toContain("collectionId=5");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok-test");
    expect(result.links).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  it("getLink fetches a single link by ID", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ response: makeLink(42) }), { status: 200 })
    );
    const link = await client.getLink(42);
    const [url] = (fetch as ReturnType<typeof vi.spyOn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/links/42");
    expect(link.id).toBe(42);
  });

  it("createLink POSTs with body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ response: makeLink(99) }), { status: 200 })
    );
    const link = await client.createLink({ url: "https://x.com", name: "X", collectionId: 1 });
    const [, init] = (fetch as ReturnType<typeof vi.spyOn>).mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(link.id).toBe(99);
  });

  it("getCollections returns array", async () => {
    const cols: Collection[] = [{ id: 1, name: "Inbox" }];
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ response: cols }), { status: 200 })
    );
    const result = await client.getCollections();
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("Inbox");
  });

  it("allLinksForCollection pages through all links", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ response: [makeLink(1)], nextCursor: 1 }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ response: [makeLink(2)], nextCursor: null }), { status: 200 })
      );

    const collected: Link[] = [];
    for await (const link of client.allLinksForCollection(5)) {
      collected.push(link);
    }

    expect(collected).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const secondCall = (fetch as ReturnType<typeof vi.spyOn>).mock.calls[1]?.[0] as string;
    expect(secondCall).toContain("cursor=1");
  });

  it("throws on non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 })
    );
    await expect(client.getLink(1)).rejects.toThrow("Linkwarden API error: 401");
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- test/linkwarden-api.test.ts
```

Expected: FAIL — `Cannot find module '../src/linkwarden/api'`

- [ ] **Step 3: Implement `src/linkwarden/api.ts`**

```typescript
import type { Collection, Link, LinkPage, SearchParams, Tag } from "../types";

export class LinkwardenClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async rawFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const url = `${this.baseUrl.replace(/\/$/, "")}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        "Authorization": `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`Linkwarden API error: ${res.status} ${res.statusText}`);
    return res;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.rawFetch(path, init);
    const json = await res.json() as { response: T };
    return json.response;
  }

  async searchLinks(params: SearchParams = {}): Promise<LinkPage> {
    const qs = new URLSearchParams();
    if (params.searchQueryString) qs.set("searchQueryString", params.searchQueryString);
    if (params.collectionId != null) qs.set("collectionId", String(params.collectionId));
    if (params.tagName) qs.set("tagName", params.tagName);
    if (params.cursor != null) qs.set("cursor", String(params.cursor));

    // nextCursor is at the top level of the response, not inside json.response
    const res = await this.rawFetch(`/api/v1/search?${qs}`);
    const json = await res.json() as { response: Link[]; nextCursor?: number | null };
    return { links: json.response ?? [], nextCursor: json.nextCursor ?? null };
  }

  async getLink(id: number): Promise<Link> {
    return this.request<Link>(`/api/v1/links/${id}`);
  }

  async createLink(body: { url: string; name?: string; description?: string; collectionId?: number; tags?: string[] }): Promise<Link> {
    return this.request<Link>("/api/v1/links", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async archiveLink(id: number): Promise<void> {
    await this.request<unknown>(`/api/v1/links/${id}/archive`, { method: "PUT" });
  }

  async getCollections(): Promise<Collection[]> {
    return this.request<Collection[]>("/api/v1/collections");
  }

  async getTags(): Promise<Tag[]> {
    return this.request<Tag[]>("/api/v1/tags");
  }

  async *allLinksForCollection(collectionId: number): AsyncGenerator<Link> {
    let cursor: number | null = null;
    do {
      const page = await this.searchLinks({ collectionId, cursor: cursor ?? undefined });
      for (const link of page.links) yield link;
      cursor = page.nextCursor;
    } while (cursor !== null);
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- test/linkwarden-api.test.ts
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/linkwarden/api.ts test/linkwarden-api.test.ts
git commit -m "feat: Linkwarden API client with cursor pagination"
```

---

## Task 3: R2 Search Sink

**Files:**
- Create: `src/sink/r2-search.ts`
- Create: `test/r2-search-sink.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/r2-search-sink.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { R2SearchSink } from "../src/sink/r2-search";
import type { NormalizedDoc } from "../src/types";

function makeDoc(id: string, extras: Partial<NormalizedDoc> = {}): NormalizedDoc {
  return {
    id,
    source: "linkwarden",
    title: "Test",
    url: "https://example.com",
    content: "some content",
    metadata: { collection: "Inbox", tags: ["a"] },
    ...extras,
  };
}

function makeMockBucket() {
  return {
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  } as unknown as R2Bucket;
}

describe("R2SearchSink", () => {
  it("upsert writes each doc as a text file with the correct key", async () => {
    const bucket = makeMockBucket();
    const sink = new R2SearchSink(bucket);

    await sink.upsert([makeDoc("linkwarden:42"), makeDoc("linkwarden:7")]);

    expect(bucket.put).toHaveBeenCalledTimes(2);
    const firstCall = (bucket.put as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(firstCall[0]).toBe("linkwarden/42.txt");
    expect(firstCall[1]).toContain("Title: Test");
    expect(firstCall[1]).toContain("some content");
    expect(firstCall[2]).toEqual({ httpMetadata: { contentType: "text/plain" } });

    const secondCall = (bucket.put as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(secondCall[0]).toBe("linkwarden/7.txt");
  });

  it("remove deletes each R2 object by derived key", async () => {
    const bucket = makeMockBucket();
    const sink = new R2SearchSink(bucket);

    await sink.remove(["linkwarden:10", "linkwarden:20"]);

    expect(bucket.delete).toHaveBeenCalledTimes(2);
    expect((bucket.delete as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("linkwarden/10.txt");
    expect((bucket.delete as ReturnType<typeof vi.fn>).mock.calls[1][0]).toBe("linkwarden/20.txt");
  });

  it("serialized content includes all metadata fields", async () => {
    const bucket = makeMockBucket();
    const sink = new R2SearchSink(bucket);
    const doc = makeDoc("linkwarden:1", {
      title: "My Link",
      url: "https://example.com/1",
      content: "readable text",
      metadata: { collection: "Research", tags: ["ai", "ml"] },
    });

    await sink.upsert([doc]);

    const body = (bucket.put as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(body).toContain("Title: My Link");
    expect(body).toContain("URL: https://example.com/1");
    expect(body).toContain("Collection: Research");
    expect(body).toContain("Tags: ai, ml");
    expect(body).toContain("readable text");
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- test/r2-search-sink.test.ts
```

Expected: FAIL — `Cannot find module '../src/sink/r2-search'`

- [ ] **Step 3: Implement `src/sink/r2-search.ts`**

```typescript
import type { NormalizedDoc, SearchSink } from "../types";

export class R2SearchSink implements SearchSink {
  constructor(private readonly bucket: R2Bucket) {}

  async upsert(docs: NormalizedDoc[]): Promise<void> {
    await Promise.all(
      docs.map((doc) =>
        this.bucket.put(this.r2Key(doc.id), this.serialize(doc), {
          httpMetadata: { contentType: "text/plain" },
        }),
      ),
    );
  }

  async remove(ids: string[]): Promise<void> {
    await Promise.all(ids.map((id) => this.bucket.delete(this.r2Key(id))));
  }

  private r2Key(docId: string): string {
    const linkId = docId.split(":")[1] ?? docId;
    return `linkwarden/${linkId}.txt`;
  }

  private serialize(doc: NormalizedDoc): string {
    return [
      `Title: ${doc.title}`,
      `URL: ${doc.url ?? ""}`,
      `Collection: ${doc.metadata.collection ?? ""}`,
      `Tags: ${(doc.metadata.tags ?? []).join(", ")}`,
      "",
      doc.content,
    ].join("\n");
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- test/r2-search-sink.test.ts
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sink/r2-search.ts test/r2-search-sink.test.ts
git commit -m "feat: R2SearchSink — write/delete normalized docs as R2 text objects"
```

---

## Task 4: Collection config helpers

**Files:**
- Create: `src/indexer/config.ts`

No standalone tests — this is trivial KV read/write used by both the indexer and MCP tools. Covered indirectly in later task tests.

- [ ] **Step 1: Create `src/indexer/config.ts`**

```typescript
import type { CollectionConfig } from "../types";
import { INDEXED_COLLECTIONS_KEY } from "../types";

export async function loadCollectionConfig(kv: KVNamespace): Promise<CollectionConfig> {
  const raw = await kv.get(INDEXED_COLLECTIONS_KEY);
  if (!raw) return { mode: "allowlist", collectionIds: [] };
  return JSON.parse(raw) as CollectionConfig;
}

export async function saveCollectionConfig(kv: KVNamespace, config: CollectionConfig): Promise<void> {
  await kv.put(INDEXED_COLLECTIONS_KEY, JSON.stringify(config));
}
```

- [ ] **Step 2: Commit**

```bash
git add src/indexer/config.ts
git commit -m "feat: KV collection config load/save helpers"
```

---

## Task 5: Indexer — sync

**Files:**
- Create: `src/indexer/sync.ts`
- Create: `test/sync.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/sync.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { syncCollection } from "../src/indexer/sync";
import type { Link, SearchSink, NormalizedDoc } from "../src/types";
import { INDEXED_IDS_PREFIX } from "../src/types";

function makeLink(id: number, collectionId = 1): Link {
  return {
    id,
    name: `Link ${id}`,
    url: `https://example.com/${id}`,
    description: `desc ${id}`,
    collectionId,
    collection: { id: collectionId, name: "Test" },
    tags: [{ id: 1, name: "tag1" }],
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeMockClient(links: Link[]) {
  return {
    async *allLinksForCollection(_collectionId: number) {
      for (const l of links) yield l;
    },
  };
}

function makeMockSink(): SearchSink & { upserted: NormalizedDoc[]; removed: string[] } {
  const upserted: NormalizedDoc[] = [];
  const removed: string[] = [];
  return {
    upserted,
    removed,
    async upsert(docs) { upserted.push(...docs); },
    async remove(ids) { removed.push(...ids); },
  };
}

function makeMockKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
  } as unknown as KVNamespace;
}

describe("syncCollection", () => {
  it("normalizes links into NormalizedDocs and upserts them", async () => {
    const links = [makeLink(1), makeLink(2)];
    const client = makeMockClient(links);
    const sink = makeMockSink();
    const kv = makeMockKV();

    await syncCollection(1, client as any, sink, kv);

    expect(sink.upserted).toHaveLength(2);
    const doc = sink.upserted[0]!;
    expect(doc.id).toBe("linkwarden:1");
    expect(doc.source).toBe("linkwarden");
    expect(doc.title).toBe("Link 1");
    expect(doc.url).toBe("https://example.com/1");
    expect(doc.content).toBe("desc 1");
    expect(doc.metadata.collection).toBe("Test");
    expect(doc.metadata.tags).toEqual(["tag1"]);
  });

  it("writes indexed IDs to KV after successful upsert", async () => {
    const links = [makeLink(10), makeLink(20)];
    const client = makeMockClient(links);
    const sink = makeMockSink();
    const kv = makeMockKV();

    await syncCollection(1, client as any, sink, kv);

    expect(kv.put).toHaveBeenCalledWith(
      `${INDEXED_IDS_PREFIX}1`,
      JSON.stringify(["linkwarden:10", "linkwarden:20"]),
    );
  });

  it("falls back to link name when description is absent", async () => {
    const link: Link = { id: 5, name: "No Desc", url: "https://x.com" };
    const client = makeMockClient([link]);
    const sink = makeMockSink();
    const kv = makeMockKV();

    await syncCollection(1, client as any, sink, kv);

    expect(sink.upserted[0]!.content).toBe("No Desc");
  });

  it("does not write KV if upsert throws", async () => {
    const client = makeMockClient([makeLink(1)]);
    const failSink: SearchSink = {
      upsert: vi.fn().mockRejectedValue(new Error("R2 error")),
      remove: vi.fn(),
    };
    const kv = makeMockKV();

    await expect(syncCollection(1, client as any, failSink, kv)).rejects.toThrow("R2 error");
    expect(kv.put).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- test/sync.test.ts
```

Expected: FAIL — `Cannot find module '../src/indexer/sync'`

- [ ] **Step 3: Implement `src/indexer/sync.ts`**

```typescript
import type { LinkwardenClient } from "../linkwarden/api";
import type { NormalizedDoc, SearchSink } from "../types";
import { INDEXED_IDS_PREFIX } from "../types";

export async function syncCollection(
  collectionId: number,
  client: Pick<LinkwardenClient, "allLinksForCollection">,
  sink: SearchSink,
  kv: KVNamespace,
): Promise<void> {
  const docs: NormalizedDoc[] = [];

  for await (const link of client.allLinksForCollection(collectionId)) {
    docs.push({
      id: `linkwarden:${link.id}`,
      source: "linkwarden",
      title: link.name,
      url: link.url,
      content: link.description?.trim() || link.name,
      metadata: {
        collection: link.collection?.name,
        tags: link.tags?.map((t) => t.name),
        createdAt: link.createdAt,
        updatedAt: link.updatedAt,
      },
    });
  }

  await sink.upsert(docs);

  await kv.put(
    `${INDEXED_IDS_PREFIX}${collectionId}`,
    JSON.stringify(docs.map((d) => d.id)),
  );
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- test/sync.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/indexer/sync.ts test/sync.test.ts
git commit -m "feat: syncCollection — fetch, normalize, upsert, write KV"
```

---

## Task 6: Indexer — reconcile

**Files:**
- Create: `src/indexer/reconcile.ts`
- Create: `test/reconcile.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/reconcile.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { reconcile } from "../src/indexer/reconcile";
import type { SearchSink } from "../src/types";
import { INDEXED_IDS_PREFIX } from "../src/types";

function makeMockKV(entries: Record<string, string>): KVNamespace {
  return {
    list: vi.fn(async ({ prefix }: { prefix: string }) => ({
      keys: Object.keys(entries)
        .filter((k) => k.startsWith(prefix))
        .map((name) => ({ name })),
      list_complete: true,
      cursor: "",
    })),
    get: vi.fn(async (key: string) => entries[key] ?? null),
    delete: vi.fn(async () => {}),
  } as unknown as KVNamespace;
}

function makeMockSink(): SearchSink & { removed: string[] } {
  const removed: string[] = [];
  return {
    removed,
    upsert: vi.fn(),
    async remove(ids) { removed.push(...ids); },
  };
}

describe("reconcile", () => {
  it("removes docs for collections not in the allowlist", async () => {
    const kv = makeMockKV({
      [`${INDEXED_IDS_PREFIX}1`]: JSON.stringify(["linkwarden:10", "linkwarden:11"]),
      [`${INDEXED_IDS_PREFIX}2`]: JSON.stringify(["linkwarden:20"]),
    });
    const sink = makeMockSink();

    await reconcile([1], sink, kv);

    // collection 2 is no longer in allowlist — should be purged
    expect(sink.removed).toContain("linkwarden:20");
    expect(sink.removed).not.toContain("linkwarden:10");
    expect(kv.delete).toHaveBeenCalledWith(`${INDEXED_IDS_PREFIX}2`);
    expect(kv.delete).not.toHaveBeenCalledWith(`${INDEXED_IDS_PREFIX}1`);
  });

  it("does nothing when all indexed collections are in the allowlist", async () => {
    const kv = makeMockKV({
      [`${INDEXED_IDS_PREFIX}5`]: JSON.stringify(["linkwarden:50"]),
    });
    const sink = makeMockSink();

    await reconcile([5, 6], sink, kv);

    expect(sink.removed).toHaveLength(0);
    expect(kv.delete).not.toHaveBeenCalled();
  });

  it("handles empty indexed-ids value gracefully", async () => {
    const kv = makeMockKV({ [`${INDEXED_IDS_PREFIX}3`]: "[]" });
    const sink = makeMockSink();

    await reconcile([], sink, kv);

    expect(sink.removed).toHaveLength(0);
    expect(kv.delete).toHaveBeenCalledWith(`${INDEXED_IDS_PREFIX}3`);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- test/reconcile.test.ts
```

Expected: FAIL — `Cannot find module '../src/indexer/reconcile'`

- [ ] **Step 3: Implement `src/indexer/reconcile.ts`**

```typescript
import type { SearchSink } from "../types";
import { INDEXED_IDS_PREFIX } from "../types";

export async function reconcile(
  currentAllowlist: number[],
  sink: SearchSink,
  kv: KVNamespace,
): Promise<void> {
  const allowSet = new Set(currentAllowlist.map(String));
  const list = await kv.list({ prefix: INDEXED_IDS_PREFIX });

  // kv.list returns at most 1000 keys per call; we'll never have that many collection IDs
  for (const { name } of list.keys) {
    const collectionId = name.slice(INDEXED_IDS_PREFIX.length);
    if (allowSet.has(collectionId)) continue;

    const raw = await kv.get(name);
    const ids: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (ids.length > 0) await sink.remove(ids);
    await kv.delete(name);
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- test/reconcile.test.ts
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/indexer/reconcile.ts test/reconcile.test.ts
git commit -m "feat: reconcile — purge R2/KV entries for deselected collections"
```

---

## Task 7: Indexer — cron handler

**Files:**
- Create: `src/indexer/cron.ts`

- [ ] **Step 1: Create `src/indexer/cron.ts`**

```typescript
import { LinkwardenClient } from "../linkwarden/api";
import { R2SearchSink } from "../sink/r2-search";
import { loadCollectionConfig } from "./config";
import { syncCollection } from "./sync";
import { reconcile } from "./reconcile";
import type { Env } from "../types";

export async function runScheduled(env: Env): Promise<void> {
  const config = await loadCollectionConfig(env.KV);
  const client = new LinkwardenClient(env.LINKWARDEN_URL, env.LINKWARDEN_TOKEN);
  const sink = new R2SearchSink(env.R2_SEARCH);

  const errors: string[] = [];

  for (const collectionId of config.collectionIds) {
    try {
      await syncCollection(collectionId, client, sink, env.KV);
      console.log(`[indexer] synced collection ${collectionId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[indexer] failed collection ${collectionId}: ${msg}`);
      errors.push(`collection ${collectionId}: ${msg}`);
    }
  }

  await reconcile(config.collectionIds, sink, env.KV);

  if (errors.length > 0) {
    throw new Error(`Indexer completed with errors:\n${errors.join("\n")}`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/indexer/cron.ts
git commit -m "feat: cron handler — sync all allowlisted collections then reconcile"
```

---

## Task 8: MCP tools — links

**Files:**
- Create: `src/mcp/tools/links.ts`

- [ ] **Step 1: Create `src/mcp/tools/links.ts`**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LinkwardenClient } from "../../linkwarden/api";

export function registerLinkTools(server: McpServer, client: LinkwardenClient): void {
  server.tool(
    "search_links",
    "Search and filter saved Linkwarden links",
    {
      query: z.string().optional().describe("Full-text search query"),
      collectionId: z.number().optional().describe("Filter by collection ID"),
      tagName: z.string().optional().describe("Filter by tag name"),
      cursor: z.number().optional().describe("Pagination cursor from a previous response"),
    },
    async ({ query, collectionId, tagName, cursor }) => {
      const page = await client.searchLinks({
        searchQueryString: query,
        collectionId,
        tagName,
        cursor,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(page, null, 2) }],
      };
    },
  );

  server.tool(
    "get_link",
    "Fetch a single link by its ID",
    { id: z.number().describe("Link ID") },
    async ({ id }) => {
      const link = await client.getLink(id);
      return {
        content: [{ type: "text", text: JSON.stringify(link, null, 2) }],
      };
    },
  );

  server.tool(
    "create_link",
    "Save a new bookmark in Linkwarden",
    {
      url: z.string().url().describe("URL to bookmark"),
      name: z.string().optional().describe("Title override"),
      description: z.string().optional().describe("Description or notes"),
      collectionId: z.number().optional().describe("Collection to save into"),
      tags: z.array(z.string()).optional().describe("Tag names to apply"),
    },
    async (body) => {
      const link = await client.createLink(body);
      return {
        content: [{ type: "text", text: JSON.stringify(link, null, 2) }],
      };
    },
  );

  server.tool(
    "archive_link",
    "Trigger or refresh the archive snapshot for a link",
    { id: z.number().describe("Link ID") },
    async ({ id }) => {
      await client.archiveLink(id);
      return {
        content: [{ type: "text", text: `Archive triggered for link ${id}` }],
      };
    },
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/mcp/tools/links.ts
git commit -m "feat: MCP link tools — search_links, get_link, create_link, archive_link"
```

---

## Task 9: MCP tools — collections and tags

**Files:**
- Create: `src/mcp/tools/collections.ts`
- Create: `src/mcp/tools/tags.ts`

- [ ] **Step 1: Create `src/mcp/tools/collections.ts`**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LinkwardenClient } from "../../linkwarden/api";
import { R2SearchSink } from "../../sink/r2-search";
import { loadCollectionConfig, saveCollectionConfig } from "../../indexer/config";
import { reconcile } from "../../indexer/reconcile";
import type { Env } from "../../types";

export function registerCollectionTools(server: McpServer, client: LinkwardenClient, env: Env): void {
  server.tool(
    "list_collections",
    "List all Linkwarden collections",
    {},
    async () => {
      const collections = await client.getCollections();
      return {
        content: [{ type: "text", text: JSON.stringify(collections, null, 2) }],
      };
    },
  );

  server.tool(
    "get_indexed_collections",
    "Get the current collection indexing configuration",
    {},
    async () => {
      const config = await loadCollectionConfig(env.KV);
      return {
        content: [{ type: "text", text: JSON.stringify(config, null, 2) }],
      };
    },
  );

  server.tool(
    "set_indexed_collections",
    "Set which collections are indexed into AI Search",
    {
      collectionIds: z
        .array(z.number())
        .describe("Collection IDs to index (replaces current list)"),
    },
    async ({ collectionIds }) => {
      const config = { mode: "allowlist" as const, collectionIds };
      await saveCollectionConfig(env.KV, config);
      const sink = new R2SearchSink(env.R2_SEARCH);
      await reconcile(collectionIds, sink, env.KV);
      return {
        content: [
          {
            type: "text",
            text: `Updated. Indexing collections: ${collectionIds.join(", ") || "none"}`,
          },
        ],
      };
    },
  );
}
```

- [ ] **Step 2: Create `src/mcp/tools/tags.ts`**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LinkwardenClient } from "../../linkwarden/api";

export function registerTagTools(server: McpServer, client: LinkwardenClient): void {
  server.tool(
    "list_tags",
    "List all tags in Linkwarden",
    {},
    async () => {
      const tags = await client.getTags();
      return {
        content: [{ type: "text", text: JSON.stringify(tags, null, 2) }],
      };
    },
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/mcp/tools/collections.ts src/mcp/tools/tags.ts
git commit -m "feat: MCP collection and tag tools"
```

---

## Task 10: MCP Agent and entry point

**Files:**
- Create: `src/mcp/agent.ts`
- Create: `src/index.ts`

- [ ] **Step 1: Create `src/mcp/agent.ts`**

```typescript
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LinkwardenClient } from "../linkwarden/api";
import { registerLinkTools } from "./tools/links";
import { registerCollectionTools } from "./tools/collections";
import { registerTagTools } from "./tools/tags";
import type { Env } from "../types";

export class LinkwardenMCP extends McpAgent {
  server = new McpServer({ name: "Linkwarden", version: "1.0.0" });

  async init(): Promise<void> {
    // McpAgent extends Durable Object Agent; env is available as this.env
    const env = this.env as Env;
    const client = new LinkwardenClient(env.LINKWARDEN_URL, env.LINKWARDEN_TOKEN);
    registerLinkTools(this.server, client);
    registerCollectionTools(this.server, client, env);
    registerTagTools(this.server, client);
  }
}
```

- [ ] **Step 2: Create `src/index.ts`**

```typescript
import { LinkwardenMCP } from "./mcp/agent";
import { runScheduled } from "./indexer/cron";
import type { Env } from "./types";

export { LinkwardenMCP };

export default {
  fetch: LinkwardenMCP.mount("/mcp"),
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduled(env));
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors. Fix any type errors before continuing.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/agent.ts src/index.ts
git commit -m "feat: LinkwardenMCP agent and Worker entry point"
```

---

## Task 11: Run full test suite

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: all tests pass. Fix any failures before proceeding.

- [ ] **Step 2: Verify wrangler can parse the config**

```bash
npx wrangler deploy --dry-run --outdir dist
```

Expected: `dist/` created, no fatal errors. (Will warn about missing KV ID and secrets — that's expected pre-provisioning.)

---

## Task 12: Provision infrastructure and deploy

- [ ] **Step 1: Create KV namespace**

```bash
npx wrangler kv namespace create linkwarden-mcp
```

Copy the printed `id` value. Also run for preview:

```bash
npx wrangler kv namespace create linkwarden-mcp --preview
```

Copy the preview `id`. Update `wrangler.jsonc`:

```jsonc
"kv_namespaces": [
  { "binding": "KV", "id": "<id from first command>", "preview_id": "<id from preview command>" }
]
```

- [ ] **Step 2: Create R2 bucket**

```bash
npx wrangler r2 bucket create linkwarden-search
```

- [ ] **Step 3: Set secrets**

```bash
npx wrangler secret put LINKWARDEN_URL
# Enter: base URL of your Linkwarden instance, e.g. https://lw.yourdomain.com

npx wrangler secret put LINKWARDEN_TOKEN
# Enter: your Linkwarden API token
```

- [ ] **Step 4: Deploy**

```bash
npx wrangler deploy
```

Expected: prints Worker URL, e.g. `https://linkwarden-mcp.<your-subdomain>.workers.dev`.

- [ ] **Step 5: Create AutoRAG instance in Cloudflare dashboard**

In the Cloudflare dashboard:
1. Navigate to **AI** → **AI Search** (AutoRAG)
2. Create a new instance named `linkwarden`
3. Set data source to R2 bucket `linkwarden-search`
4. Save

- [ ] **Step 6: Commit the updated wrangler.jsonc**

```bash
git add wrangler.jsonc
git commit -m "chore: add provisioned KV namespace IDs to wrangler.jsonc"
```

---

## Task 13: Verify and cut over

- [ ] **Step 1: Test MCP tools with wrangler MCP inspector**

```bash
npx wrangler mcp inspect
```

Or open the Worker URL with MCP Inspector pointed at `https://<worker-url>/mcp`. Verify:
- `list_collections` returns your Linkwarden collections
- `search_links` with no args returns recent links
- `get_indexed_collections` returns `{ mode: "allowlist", collectionIds: [] }`

- [ ] **Step 2: Configure indexed collections**

Via `set_indexed_collections` MCP tool or directly:

```bash
npx wrangler kv key put --binding KV "config:indexed-collections" '{"mode":"allowlist","collectionIds":[1]}'
```

Replace `1` with actual collection IDs from `list_collections`.

- [ ] **Step 3: Trigger a manual cron run**

```bash
npx wrangler dev
# In a second terminal:
curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"
```

Check logs for `[indexer] synced collection X`. Verify files appear in the R2 bucket:

```bash
npx wrangler r2 object list linkwarden-search
```

- [ ] **Step 4: Apply Cloudflare Access policy**

In Cloudflare dashboard: add an Access application for `<worker-url>/mcp` with your existing Access policy / service token.

- [ ] **Step 5: Update AI Controls**

Point the Linkwarden MCP connector in AI Controls at `https://<worker-url>/mcp`.

- [ ] **Step 6: Decommission Docker MCP container**

Stop and remove the old Docker container. Confirm AI Controls works with the new Worker endpoint.
