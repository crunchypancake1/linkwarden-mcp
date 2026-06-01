import { LinkwardenClient } from "../linkwarden/api";
import { R2SearchSink } from "../sink/r2-search";
import { loadCollectionConfig } from "./config";
import { syncCollection } from "./sync";
import { reconcile } from "./reconcile";
import type { Env } from "../types";

export async function runScheduled(env: Env): Promise<void> {
  const config = await loadCollectionConfig(env.KV);
  const client = new LinkwardenClient(env.LINKWARDEN_URL, env.LINKWARDEN_TOKEN);
  const sink = new R2SearchSink(env.SINK_BUCKET);

  const errors: string[] = [];

  for (const collectionId of config.collectionIds) {
    try {
      await syncCollection(collectionId, client, sink, env.KV);
      console.log(`[indexer] synced collection ${collectionId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[indexer] failed collection ${collectionId}: ${msg}`);
      errors.push(`collection ${collectionId}: ${msg}`);
    }
  }

  await reconcile(config.collectionIds, sink, env.KV);

  if (errors.length > 0) {
    throw new Error(`Indexer completed with errors:\n${errors.join("\n")}`);
  }
}
