# Linkwarden MCP

An [MCP](https://modelcontextprotocol.io) server that exposes a [Linkwarden](https://linkwarden.app/)
bookmark collection as a tool set, running as a stateful agent on Cloudflare Workers. Point an MCP
client (Claude, etc.) at the deployed endpoint and it can browse, search, filter, create, and
archive links directly against your own Linkwarden instance.

## How it works

Every tool call goes straight to the Linkwarden REST API on your live instance — there's no index,
cache, or background sync involved. The instance isn't exposed publicly: requests reach it over a
[Workers VPC](https://developers.cloudflare.com/workers-vpc/) service binding, which tunnels to the
private host via `cloudflared`.

```
MCP client ──HTTP/SSE──► Worker (/mcp) ──► LinkwardenMCP (Durable Object)
                                                  │
                                     LINKWARDEN_VPC binding (+ LINKWARDEN_TOKEN)
                                                  │
                                    Cloudflare Tunnel → Linkwarden API (private)
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
```

Linkwarden is reached through a VPC Service, created once against the Cloudflare Tunnel that runs on
the same network as the instance:

```bash
wrangler vpc service create linkwarden \
  --type http --tunnel-id <tunnel-id> --hostname <internal-host> --http-port 9000
```

`wrangler.jsonc` binds the returned service ID under `vpc_services`, and the `LINKWARDEN_URL` var
supplies the URL used for the request path and `Host` header (the VPC Service — not this URL —
decides where the request actually goes):

```jsonc
"vars": { "LINKWARDEN_URL": "http://mediaserver:9000" },
"vpc_services": [
  { "binding": "LINKWARDEN_VPC", "service_id": "<service-id>", "remote": true }
]
```

`LINKWARDEN_TOKEN` (a Linkwarden API access token) is read from Cloudflare's
[Secrets Store](https://developers.cloudflare.com/secrets-store/), not a plain Wrangler secret.
Create it once per account and it's reusable across Workers:

```bash
wrangler secrets-store secret create <store-id> \
  --name linkwarden-token --scopes workers --remote
```

`wrangler.jsonc` then binds it via `secrets_store_secrets`:

```jsonc
"secrets_store_secrets": [
  { "binding": "LINKWARDEN_TOKEN", "store_id": "<store-id>", "secret_name": "linkwarden-token" }
]
```

For local dev, create a local-only secret with the same name (omit `--remote`) so `wrangler dev`
has something to read. The VPC binding is marked `remote: true`, so `wrangler dev` connects to the
real VPC Service — there is no local emulation of it.

See `CLAUDE.md` for the full architecture and binding reference.

## Development

```bash
npm run dev         # wrangler dev — local development with hot reload
npm run test        # vitest run
npm run typecheck   # tsc --noEmit
```

## Deploy

Cloudflare Workers Builds is connected to this repo — pushing to `master` deploys automatically
(`npm run build` then `wrangler deploy`). `npm run deploy` remains available for manual/ad-hoc
deploys. Either way, the `linkwarden-token` secret must exist in the account's Secrets Store — it
is never stored in the repo.

## Stack

- [Cloudflare Workers](https://developers.cloudflare.com/workers/) + Durable Objects (SQLite-backed)
- [Cloudflare Agents SDK](https://github.com/cloudflare/agents) (`agents/mcp`)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- TypeScript, [Zod](https://zod.dev/) for tool input schemas, [Vitest](https://vitest.dev/)
