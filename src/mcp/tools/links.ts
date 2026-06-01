import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LinkwardenClient } from "../../linkwarden/api";
import type { Env, Link, LinkPage } from "../../types";

function formatLink(link: Link) {
  return {
    id: link.id,
    name: link.name,
    url: link.url,
    ...(link.description ? { description: link.description } : {}),
    collectionId: link.collectionId,
    tags: link.tags?.map((t) => t.name) ?? [],
  };
}

function formatPage(page: LinkPage) {
  return {
    links: page.links.map(formatLink),
    nextCursor: page.nextCursor,
  };
}

function text(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results = await (env.AI as any).autorag(
        env.AI_SEARCH_INSTANCE
      ).search({
        query,
        max_num_results: topK ?? 5,
        ranking_options: { score_threshold: 0.3 },
        filters: { folder: "linkwarden/" },
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
    "list_links",
    "List links, optionally filtered to specific collections. With collectionIds, returns all links across those collections. Without collectionIds, returns the first page of all links with a cursor for pagination.",
    {
      collectionIds: z.array(z.number()).optional().describe("Collection IDs to fetch links from. If omitted, returns first page of all links."),
      cursor: z.number().optional().describe("Pagination cursor (only used when collectionIds is omitted)"),
    },
    async ({ collectionIds, cursor }) => {
      if (collectionIds && collectionIds.length > 0) {
        const all: Link[] = [];
        for (const id of collectionIds) {
          for await (const link of client.allLinksForCollection(id)) {
            all.push(link);
          }
        }
        return text(all.map(formatLink));
      }

      const page = await client.listLinks({ cursor });
      return text(formatPage(page));
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
      return text(formatPage(page));
    },
  );

  server.tool(
    "get_link",
    "Fetch a single link by its ID",
    { id: z.number().describe("Link ID") },
    async ({ id }) => {
      const link = await client.getLink(id);
      return text(formatLink(link));
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
      return text(formatLink(link));
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
