# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # wrangler dev — local development with hot reload
npm run deploy       # wrangler deploy — deploy to Cloudflare Workers
npm run test         # vitest run — run all tests once
npm run typecheck    # tsc --noEmit — type-check without emitting
```

Run a single test file:
```bash
npx vitest run test/indexer/sync.test.ts
```

## Architecture

This is a Cloudflare Workers project that exposes Linkwarden bookmarks as an MCP (Model Context
Protocol) server: it indexes links into an AI search sink for semantic search, and it can write
back to a live Linkwarden instance via the Linkwarden API.

### Data flow

Read path (search/browse, backed by the R2 index):
```
Linkwarden API (cron, hourly)
    → syncCollection() per allow-listed collection
    → enrich with archives/{collectionId}/{linkId}_readability.json (LINKWARDEN_DATA bucket)
    → R2SearchSink (SINK_BUCKET)
    → Workers AI AutoRAG (AI_SEARCH_INSTANCE = "personal-search")
    → MCP search_links_semantic tool queries AutoRAG

Linkwarden archive write → LINKWARDEN_DATA bucket
    → R2 event notifications (put/delete) → linkwarden-events Queue
    → queue handler → processR2Event() → R2SearchSink (SINK_BUCKET)
```

Write path (mutating tools, bypasses the index entirely):
```
MCP create_link / archive_link
    → LINKWARDEN_URL + LINKWARDEN_TOKEN → Linkwarden API on the live instance
```

### Key modules

- **`src/index.ts`** — Worker entrypoint: mounts the DO as an MCP server at `/mcp` via
  `LinkwardenMCP.serve()`, wires the `scheduled()` cron handler to `runScheduled()` and the
  `linkwarden-events` Queue consumer to `processR2Event()`.
- **`src/mcp/agent.ts`** — `LinkwardenMCP` Durable Object (extends `McpAgent`). Registers MCP tools
  from `src/mcp/tools/*`.
- **`src/mcp/tools/links.ts`** — link tools: `search_links_semantic` (AutoRAG), `list_links`,
  `search_links`, `get_link`, `create_link`, `archive_link`.
- **`src/mcp/tools/collections.ts`** — `list_collections`, `get_indexed_collections`,
  `set_indexed_collections` (updates the KV allowlist and reconciles the sink).
- **`src/mcp/tools/tags.ts`** — `list_tags`.
- **`src/indexer/cron.ts`** — `runScheduled()`: syncs every allow-listed collection, then calls
  `reconcile()` to drop anything no longer allow-listed.
- **`src/indexer/sync.ts`** — `syncCollection()`: pages all links in a collection from the
  Linkwarden API, enriches content from the archived Readability JSON when present, upserts into
  the sink, and records the resulting doc IDs in KV (`indexed-ids:{collectionId}`) for reconcile.
- **`src/indexer/event.ts`** — `processR2Event()`: handles a single R2 put/delete on
  `LINKWARDEN_DATA`, parsed via `parseArchiveKey()`. On delete, removes the doc from the sink. On
  put, checks the collection is allow-listed, re-fetches the link from the API, and upserts a
  normalized doc built from the Readability content.
- **`src/indexer/archive.ts`** — `parseArchiveKey()` / `readabilityKey()`: parse/build the
  `archives/{collectionId}/{linkId}_readability.json` key format Linkwarden writes to R2.
- **`src/indexer/config.ts`** — load/save the collection allowlist in KV
  (`config:indexed-collections`).
- **`src/indexer/reconcile.ts`** — removes indexed docs for collections that fell off the
  allowlist, using the per-collection ID lists written by `syncCollection()`.
- **`src/linkwarden/api.ts`** — `LinkwardenClient`: thin wrapper over the Linkwarden REST API
  (search, list, get, create, archive links; list collections/tags).
- **`src/sink/r2-search.ts`** — `R2SearchSink`: implements `SearchSink`; writes docs to
  `SINK_BUCKET` at path `linkwarden/<linkId>.json`.
- **`src/types.ts`** — Shared types: `Env`, `NormalizedDoc`, `SearchSink`, `Link`, `Collection`,
  `CollectionConfig`, `ReadabilityContent`, `R2EventNotificationMessage`.

### Bindings (wrangler.jsonc)

| Binding | Type | Purpose |
|---|---|---|
| `LINKWARDEN_MCP` | Durable Object | McpAgent instance (with SQLite) |
| `LINKWARDEN_DATA` | R2 | Linkwarden's archive/storage bucket (read-only by this worker) |
| `SINK_BUCKET` | R2 | Shared AI search sink (`ai-search-sink` bucket) — written by indexer |
| `KV` | KV | Collection allowlist config + per-collection indexed-ID lists |
| `AI` | Workers AI | AutoRAG queries |

`LINKWARDEN_URL` and `LINKWARDEN_TOKEN` are secrets (`wrangler secret put`), used both by the
write-path tools in `src/mcp/tools/links.ts` and by the indexer's `LinkwardenClient` calls.

### Shared sink contract

`SINK_BUCKET` (`ai-search-sink`) is shared with other workers (e.g. joplin-mcp). Keys are
source-prefixed: `linkwarden/<linkId>.json`. The `NormalizedDoc` interface in `src/types.ts` is the
cross-worker document contract — changes to it must be coordinated across all workers writing to
this bucket.

### Collection allowlist

Stored in KV as JSON at key `config:indexed-collections` with shape
`{ mode: "allowlist", collectionIds: number[] }`. Only collections in this list are synced by cron
or accepted by the queue handler; `set_indexed_collections` updates it and immediately reconciles
the sink to match.

### Readability archive format

Linkwarden writes a Mozilla Readability parse of each link's article to
`archives/{collectionId}/{linkId}_readability.json` in the `LINKWARDEN_DATA` bucket
(`ReadabilityContent` in `src/types.ts`). Both the cron sync and the queue handler prefer this
content over the link's own `textContent`/`description` when building the indexed doc.
