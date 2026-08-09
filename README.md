# Linkwarden MCP

An [MCP](https://modelcontextprotocol.io) server that exposes a [Linkwarden](https://linkwarden.app/)
bookmark collection as a tool set, running as a stateful agent on Cloudflare Workers. Point an MCP
client (Claude, etc.) at the deployed endpoint and it can semantically search your saved links,
browse and filter by collection/tag, and create links or trigger archive snapshots directly
against your own Linkwarden instance.

## How it works

Links reach this Worker two ways:

**Read path** — an hourly cron syncs allow-listed collections from the Linkwarden API into a
shared AI search sink, enriched with Readability article content where available. Linkwarden's own
archive writes (via its R2 storage integration) also fire live updates through a Queue.

```
Linkwarden API (cron, hourly)
    → syncCollection() per allow-listed collection
    → enrich with archives/{collectionId}/{linkId}_readability.json (LINKWARDEN_DATA bucket)
    → R2SearchSink (SINK_BUCKET)
    → Workers AI AutoRAG
    → MCP search_links_semantic tool queries AutoRAG

Linkwarden archive write → LINKWARDEN_DATA bucket
    → R2 event notifications (put/delete) → linkwarden-events Queue
    → queue handler → processR2Event() → SINK_BUCKET
```

**Write path** — the mutating tools (`create_link`, `archive_link`, ...) skip the index and call the
Linkwarden API on your live instance directly, over a token-authenticated client.

```
MCP client ──HTTP/SSE──► Worker (/mcp) ──► LinkwardenMCP (Durable Object)
                                                  │
                                    read: R2 + AutoRAG   write: Linkwarden API
```

`LinkwardenMCP` is a [`McpAgent`](https://github.com/cloudflare/agents) hosted on a Durable Object.

## Tools

| Tool | Description |
|---|---|
| `search_links_semantic` | Semantic AI search over indexed links (AutoRAG) |
| `list_links` | List links, optionally filtered to specific collections |
| `search_links` | Full-text search and filter by collection/tag |
| `get_link` | Fetch a single link by ID |
| `create_link` | Save a new bookmark |
| `archive_link` | Trigger or refresh a link's archive snapshot |
| `list_collections` | List all Linkwarden collections |
| `get_indexed_collections` | Read the current collection indexing configuration |
| `set_indexed_collections` | Set which collections get indexed (allowlist) |
| `list_tags` | List all tags |

## Setup

```bash
npm install
wrangler secret put LINKWARDEN_URL     # base URL of your Linkwarden instance
wrangler secret put LINKWARDEN_TOKEN   # Linkwarden API token
```

Before deploying, also configure in `wrangler.jsonc`:
- `vars.AI_SEARCH_INSTANCE` — name of the AutoRAG instance backing `search_links_semantic`
- R2 buckets (`LINKWARDEN_DATA` for Linkwarden's archive/storage bucket, read-only here; `SINK_BUCKET`
  for the shared search sink)
- the `KV` namespace and `linkwarden-events` Queue consumer

See `CLAUDE.md` for the full architecture and binding reference.

## Development

```bash
npm run dev         # wrangler dev — local development with hot reload
npm run test        # vitest run
npm run typecheck   # tsc --noEmit
```

## Deploy

```bash
npm run deploy
```

Or connect this repository to a Cloudflare Worker for git-based deploys. Either way,
`LINKWARDEN_TOKEN` must be set as a Wrangler secret in the target environment — it is never stored
in the repo.

## Stack

- [Cloudflare Workers](https://developers.cloudflare.com/workers/) + Durable Objects (SQLite-backed)
- [Cloudflare Agents SDK](https://github.com/cloudflare/agents) (`agents/mcp`)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- TypeScript, [Zod](https://zod.dev/) for tool input schemas, [Vitest](https://vitest.dev/)
