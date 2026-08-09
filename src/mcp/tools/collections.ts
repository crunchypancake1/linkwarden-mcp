import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LinkwardenClient } from "../../linkwarden/api";

export function registerCollectionTools(server: McpServer, client: LinkwardenClient): void {
  server.tool(
    "list_collections",
    "List all Linkwarden collections",
    {},
    async () => {
      const collections = await client.getCollections();
      return { content: [{ type: "text", text: JSON.stringify(collections, null, 2) }] };
    },
  );
}
