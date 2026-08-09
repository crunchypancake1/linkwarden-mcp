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
npx vitest run test/linkwarden-api.test.ts
```

## Architecture

This is a Cloudflare Workers project that exposes Linkwarden bookmarks as an MCP (Model Context
Protocol) server. It's a thin, stateless passthrough: every tool call goes straight to the
Linkwarden REST API on your live instance — there is no index, cache, or background sync.

```
MCP client ──HTTP/SSE──► Worker (/mcp) ──► LinkwardenMCP (Durable Object)
                                                  │
                                    LINKWARDEN_URL + LINKWARDEN_TOKEN → Linkwarden API
```

### Key modules

- **`src/index.ts`** — Worker entrypoint: mounts the DO as an MCP server at `/mcp` via
  `LinkwardenMCP.serve()`.
- **`src/mcp/agent.ts`** — `LinkwardenMCP` Durable Object (extends `McpAgent`). Registers MCP tools
  from `src/mcp/tools/*`.
- **`src/mcp/tools/links.ts`** — link tools: `list_links`, `search_links`, `get_link`,
  `create_link`, `archive_link`.
- **`src/mcp/tools/collections.ts`** — `list_collections`.
- **`src/mcp/tools/tags.ts`** — `list_tags`.
- **`src/linkwarden/api.ts`** — `LinkwardenClient`: thin wrapper over the Linkwarden REST API
  (search, list, get, create, archive links; list collections/tags).
- **`src/types.ts`** — Shared types: `Env`, `Link`, `LinkPage`, `Collection`, `Tag`, `SearchParams`.

### Bindings (wrangler.jsonc)

| Binding | Type | Purpose |
|---|---|---|
| `LINKWARDEN_MCP` | Durable Object | McpAgent instance (with SQLite) |

`LINKWARDEN_URL` and `LINKWARDEN_TOKEN` are secrets (`wrangler secret put`), used by
`src/mcp/tools/*` via `LinkwardenClient` to call the live Linkwarden instance.
