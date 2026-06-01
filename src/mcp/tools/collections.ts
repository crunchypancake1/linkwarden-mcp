import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LinkwardenClient } from "../../linkwarden/api";
import { R2SearchSink } from "../../sink/r2-search";
import { loadCollectionConfig, saveCollectionConfig } from "../../indexer/config";
import { reconcile } from "../../indexer/reconcile";
import type { Env } from "../../types";

export function registerCollectionTools(server: McpServer, client: LinkwardenClient, env: Env): void {
  server.tool(
    "list_collections",
    "List all Linkwarden collections",
    {},
    async () => {
      const collections = await client.getCollections();
      return { content: [{ type: "text", text: JSON.stringify(collections, null, 2) }] };
    },
  );

  server.tool(
    "get_indexed_collections",
    "Get the current collection indexing configuration",
    {},
    async () => {
      const config = await loadCollectionConfig(env.KV);
      return { content: [{ type: "text", text: JSON.stringify(config, null, 2) }] };
    },
  );

  server.tool(
    "set_indexed_collections",
    "Set which collections are indexed into AI Search",
    {
      collectionIds: z.array(z.number()).describe("Collection IDs to index (replaces current list)"),
    },
    async ({ collectionIds }) => {
      const config = { mode: "allowlist" as const, collectionIds };
      await saveCollectionConfig(env.KV, config);
      const sink = new R2SearchSink(env.SINK_BUCKET);
      await reconcile(collectionIds, sink, env.KV);
      return {
        content: [{
          type: "text",
          text: `Updated. Indexing collections: ${collectionIds.join(", ") || "none"}`,
        }],
      };
    },
  );
}
