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
| `LINKWARDEN_TOKEN` | Secrets Store binding | Linkwarden API token, read via `await env.LINKWARDEN_TOKEN.get()` |

`LINKWARDEN_URL` is a Wrangler secret (`wrangler secret put`). `LINKWARDEN_TOKEN` is a
[Secrets Store](https://developers.cloudflare.com/secrets-store/) binding declared under
`secrets_store_secrets` in `wrangler.jsonc` (store `d947ac5bb8ef4800ac46fc59128a1a09`, secret name
`linkwarden-token`), reused across Workers rather than set per-project. It's an async binding —
resolved once in `agent.ts#init` — not a plain string like `LINKWARDEN_URL`.

`wrangler secret put` only affects deployed Workers. For `npm run dev`, put `LINKWARDEN_URL` in a
gitignored `.dev.vars` at the repo root:

```
LINKWARDEN_URL=https://your-linkwarden.example.com
```

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
- **`noUncheckedIndexedAccess` is on** — `arr[0]` types as `T | undefined`; index access needs a
  guard or `?.`.

## Testing

`test/linkwarden-api.test.ts` covers `LinkwardenClient` only, stubbing `globalThis.fetch` with
`vi.spyOn` and asserting on the URL and `init` it receives. Vitest runs in a plain `node`
environment (not `@cloudflare/vitest-pool-workers`), so Durable Object state and the MCP tool
handlers aren't covered — test new API surface at the client layer.
