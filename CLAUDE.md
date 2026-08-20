# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # wrangler dev — local development with hot reload
npm run deploy       # wrangler deploy — manual/ad-hoc deploy to Cloudflare Workers
npm run test         # vitest run — run all tests once
npm run typecheck    # tsc --noEmit — type-check without emitting
```

Run a single test file:
```bash
npx vitest run test/linkwarden-api.test.ts
```

### Deployment

Production deploys are automatic: Cloudflare Workers Builds is connected to this repo's GitHub
integration and deploys on every push to `master` (runs `npm run build`, i.e. `tsc --noEmit`, then
`wrangler deploy`). Don't rely on running `npm run deploy` locally to ship a change — commit and
push to `master` instead. `npm run deploy` is still useful for one-off manual deploys (e.g. testing
a binding change before committing), but the source of truth for what's live is `master`.

## Architecture

This is a Cloudflare Workers project that exposes Linkwarden bookmarks as an MCP (Model Context
Protocol) server. It's a thin, stateless passthrough: every tool call goes straight to the
Linkwarden REST API on your live instance — there is no index, cache, or background sync. The
instance is private; the Worker reaches it through a [Workers VPC](https://developers.cloudflare.com/workers-vpc/)
service binding rather than over the public internet.

```
MCP client ──HTTP/SSE──► Worker (/mcp) ──► LinkwardenMCP (Durable Object)
                                                  │
                                     LINKWARDEN_VPC binding (+ LINKWARDEN_TOKEN)
                                                  │
                                    Cloudflare Tunnel → Linkwarden API (private)
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
  (search, list, get, create, archive links; list collections/tags). It never calls global `fetch`;
  it takes an `HttpFetcher` (the `LINKWARDEN_VPC` binding in production, a stub in tests).
- **`src/types.ts`** — Shared types: `Env`, `Link`, `LinkPage`, `Collection`, `Tag`, `SearchParams`.

### Bindings (wrangler.jsonc)

| Binding | Type | Purpose |
|---|---|---|
| `LINKWARDEN_MCP` | Durable Object | McpAgent instance (with SQLite) |
| `LINKWARDEN_VPC` | VPC Service | Private route to the Linkwarden host (`vpc_services`, service `01a0203c-baee-7381-bcb5-964ffff962f6`) |
| `LINKWARDEN_TOKEN` | Secrets Store binding | Linkwarden API token, read via `await env.LINKWARDEN_TOKEN.get()` |

`LINKWARDEN_URL` is a plain var in `wrangler.jsonc` (`http://mediaserver:9000`) — not a secret, and
not what routes the request. A VPC Service binding always connects to the host and port registered
on the service; the URL only supplies the path plus the `Host` header. `LINKWARDEN_TOKEN` is a
[Secrets Store](https://developers.cloudflare.com/secrets-store/) binding declared under
`secrets_store_secrets` in `wrangler.jsonc` (store `d947ac5bb8ef4800ac46fc59128a1a09`, secret name
`linkwarden-token`), reused across Workers rather than set per-project. It's an async binding —
resolved once in `agent.ts#init` — not a plain string like `LINKWARDEN_URL`.

The VPC binding is declared `remote: true`, so `npm run dev` uses the real VPC Service — there is no
local emulation, and the tunnel must be up for local dev to work.

`LINKWARDEN_TOKEN` needs a local-only Secrets Store secret with the same name (`wrangler
secrets-store secret create <store-id> --name linkwarden-token --scopes workers`, omitting
`--remote`) so `wrangler dev` has something to read.

## Gotchas

- **Response envelope** — Linkwarden wraps every payload in `{ response: T }`. `request<T>()`
  unwraps it, but paginated endpoints (`/api/v1/search`, `/api/v1/links`) return `nextCursor` as a
  *sibling* of `response`, so they use `rawFetch` and parse the body themselves. New paginated
  endpoints must do the same.
- **`/api/v1/tags` doesn't follow the `{ response: T }` envelope** — it returns
  `{ data: { tags: Tag[] } }` instead. `getTags()` uses `rawFetch` and parses this shape directly;
  don't route it through `request<T>()`. Verify the actual envelope shape for any new endpoint
  before assuming `{ response: T }` — Linkwarden isn't consistent across its API.
- **`list_links` with `collectionIds`** drains every page per collection via
  `allLinksForCollection` and ignores `cursor`. Only the unfiltered path is cursor-paginated.
- **Renaming the DO class needs a migration** — `LinkwardenMCP` is bound by class name in
  `wrangler.jsonc` under migration tag `v1` (`new_sqlite_classes`). A rename requires a new tag.
- **VPC Service bindings ignore the URL's host and port** — routing comes from the service
  definition (`wrangler vpc service list`). Changing `LINKWARDEN_URL` changes the `Host` header and
  path, not the destination; to point at a different host, edit or recreate the VPC Service.
- **`noUncheckedIndexedAccess` is on** — `arr[0]` types as `T | undefined`; index access needs a
  guard or `?.`.

## Testing

`test/linkwarden-api.test.ts` covers `LinkwardenClient` only, passing a `{ fetch: vi.fn() }` stub in
place of the VPC binding and asserting on the URL and `init` it receives. Vitest runs in a plain `node`
environment (not `@cloudflare/vitest-pool-workers`), so Durable Object state and the MCP tool
handlers aren't covered — test new API surface at the client layer.
