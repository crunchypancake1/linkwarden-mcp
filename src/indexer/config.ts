import type { CollectionConfig } from "../types";
import { INDEXED_COLLECTIONS_KEY } from "../types";

export async function loadCollectionConfig(kv: KVNamespace): Promise<CollectionConfig> {
  const raw = await kv.get(INDEXED_COLLECTIONS_KEY);
  if (!raw) return { mode: "allowlist", collectionIds: [] };
  return JSON.parse(raw) as CollectionConfig;
}

export async function saveCollectionConfig(kv: KVNamespace, config: CollectionConfig): Promise<void> {
  await kv.put(INDEXED_COLLECTIONS_KEY, JSON.stringify(config));
}
