# Linkwarden MCP

An [MCP](https://modelcontextprotocol.io) server that exposes a [Linkwarden](https://linkwarden.app/)
bookmark collection as a tool set, running as a stateful agent on Cloudflare Workers. Point an MCP
client (Claude, etc.) at the deployed endpoint and it can browse, search, filter, create, and
archive links directly against your own Linkwarden instance.

## How it works

Every tool call goes straight to the Linkwarden REST API on your live instance — there's no index,
cache, or background sync involved.

```
MCP client ──HTTP/SSE──► Worker (/mcp) ──► LinkwardenMCP (Durable Object)
                                                  │
                                    LINKWARDEN_URL + LINKWARDEN_TOKEN → Linkwarden API
```

`LinkwardenMCP` is a [`McpAgent`](https://github.com/cloudflare/agents) hosted on a Durable Object.

## Tools

| Tool | Description |
|---|---|
| `list_links` | List links, optionally filtered to specific collections |
| `search_links` | Full-text search and filter by collection/tag |
| `get_link` | Fetch a single link by ID |
| `create_link` | Save a new bookmark |
| `archive_link` | Trigger or refresh a link's archive snapshot |
| `list_collections` | List all Linkwarden collections |
| `list_tags` | List all tags |

## Setup

```bash
npm install
wrangler secret put LINKWARDEN_URL     # base URL of your Linkwarden instance
wrangler secret put LINKWARDEN_TOKEN   # Linkwarden API token
```

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
