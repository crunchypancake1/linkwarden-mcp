import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LinkwardenClient } from "../../linkwarden/api";
import type { Env } from "../../types";

export function registerLinkTools(server: McpServer, client: LinkwardenClient, env: Env): void {
  server.tool(
    "search_links_semantic",
    "Semantic AI search over indexed Linkwarden links. Returns ranked results relevant to the query.",
    {
      query: z.string().describe("Search query"),
      topK: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Max number of results (default 5)"),
    },
    async ({ query, topK }) => {
      const filters = { key: "folder" as const, type: "gte" as const, value: "linkwarden/" };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results = await (env.AI as any).autorag(
        env.AI_SEARCH_INSTANCE
      ).search({
        query,
        max_num_results: topK ?? 5,
        ranking_options: { score_threshold: 0.3 },
        filters,
      }) as { data: Array<{ filename: string; score: number; content: Array<{ type: string; text: string }> }> };

      if (!results.data || results.data.length === 0) {
        return { content: [{ type: "text" as const, text: "No results found." }] };
      }

      const text = results.data
        .map((r, i) => {
          const body = r.content.map((c) => c.text).join("\n");
          return `[${i + 1}] ${r.filename} (score: ${r.score.toFixed(3)})\n${body}`;
        })
        .join("\n\n---\n\n");

      return { content: [{ type: "text" as const, text }] };
    },
  );
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
