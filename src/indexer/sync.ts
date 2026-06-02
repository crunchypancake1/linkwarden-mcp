import type { LinkwardenClient } from "../linkwarden/api";
import type { NormalizedDoc, ReadabilityContent, SearchSink } from "../types";
import { INDEXED_IDS_PREFIX } from "../types";
import { readabilityKey } from "./archive";

export async function syncCollection(
  collectionId: number,
  client: Pick<LinkwardenClient, "allLinksForCollection">,
  sink: SearchSink,
  kv: KVNamespace,
  dataBucket?: R2Bucket,
): Promise<void> {
  const docs: NormalizedDoc[] = [];

  for await (const link of client.allLinksForCollection(collectionId)) {
    let content = link.textContent?.trim() || link.description?.trim() || link.name;

    if (dataBucket) {
      const key = readabilityKey(collectionId, link.id);
      const r2obj = await dataBucket.get(key);
      if (r2obj) {
        const readability = await r2obj.json<ReadabilityContent>();
        const fromR2 = readability.textContent?.trim();
        if (fromR2) content = fromR2;
      }
    }

    docs.push({
      id: `linkwarden:${link.id}`,
      source: "linkwarden",
      title: link.name,
      url: link.url,
      content,
      metadata: {
        collection: link.collection?.name,
        tags: link.tags?.map((t) => t.name),
        createdAt: link.createdAt,
        updatedAt: link.updatedAt,
      },
    });
  }

  await sink.upsert(docs);

  await kv.put(
    `${INDEXED_IDS_PREFIX}${collectionId}`,
    JSON.stringify(docs.map((d) => d.id)),
  );
}
