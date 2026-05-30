import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LinkwardenClient } from "../../linkwarden/api";

export function registerLinkTools(server: McpServer, client: LinkwardenClient): void {
  server.tool(
    "search_links",
    "Search and filter saved Linkwarden links",
    {
      query: z.string().optional().describe("Full-text search query"),
      collectionId: z.number().optional().describe("Filter by collection ID"),
      tagName: z.string().optional().describe("Filter by tag name"),
      cursor: z.number().optional().describe("Pagination cursor from a previous response"),
    },
    async ({ query, collectionId, tagName, cursor }) => {
      const page = await client.searchLinks({
        searchQueryString: query,
        collectionId,
        tagName,
        cursor,
      });
      return { content: [{ type: "text", text: JSON.stringify(page, null, 2) }] };
    },
  );

  server.tool(
    "get_link",
    "Fetch a single link by its ID",
    { id: z.number().describe("Link ID") },
    async ({ id }) => {
      const link = await client.getLink(id);
      return { content: [{ type: "text", text: JSON.stringify(link, null, 2) }] };
    },
  );

  server.tool(
    "create_link",
    "Save a new bookmark in Linkwarden",
    {
      url: z.string().url().describe("URL to bookmark"),
      name: z.string().optional().describe("Title override"),
      description: z.string().optional().describe("Description or notes"),
      collectionId: z.number().optional().describe("Collection to save into"),
      tags: z.array(z.string()).optional().describe("Tag names to apply"),
    },
    async (body) => {
      const link = await client.createLink(body);
      return { content: [{ type: "text", text: JSON.stringify(link, null, 2) }] };
    },
  );

  server.tool(
    "archive_link",
    "Trigger or refresh the archive snapshot for a link",
    { id: z.number().describe("Link ID") },
    async ({ id }) => {
      await client.archiveLink(id);
      return { content: [{ type: "text", text: `Archive triggered for link ${id}` }] };
    },
  );
}
