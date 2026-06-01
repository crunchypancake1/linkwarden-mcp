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
    const env = this.env as Env;
    const client = new LinkwardenClient(env.LINKWARDEN_URL, env.LINKWARDEN_TOKEN);
    registerLinkTools(this.server, client, env);
    registerCollectionTools(this.server, client, env);
    registerTagTools(this.server, client);
  }
}
