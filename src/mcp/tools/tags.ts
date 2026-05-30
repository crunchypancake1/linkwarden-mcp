import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LinkwardenClient } from "../../linkwarden/api";

export function registerTagTools(server: McpServer, client: LinkwardenClient): void {
  server.tool(
    "list_tags",
    "List all tags in Linkwarden",
    {},
    async () => {
      const tags = await client.getTags();
      return { content: [{ type: "text", text: JSON.stringify(tags, null, 2) }] };
    },
  );
}
