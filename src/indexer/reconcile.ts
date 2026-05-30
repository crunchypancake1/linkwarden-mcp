import type { SearchSink } from "../types";
import { INDEXED_IDS_PREFIX } from "../types";

export async function reconcile(
  currentAllowlist: number[],
  sink: SearchSink,
  kv: KVNamespace,
): Promise<void> {
  const allowSet = new Set(currentAllowlist.map(String));
  const list = await kv.list({ prefix: INDEXED_IDS_PREFIX });

  // kv.list returns at most 1000 keys per call; we'll never have that many collection IDs
  for (const { name } of list.keys) {
    const collectionId = name.slice(INDEXED_IDS_PREFIX.length);
    if (allowSet.has(collectionId)) continue;

    const raw = await kv.get(name);
    const ids: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (ids.length > 0) await sink.remove(ids);
    await kv.delete(name);
  }
}
