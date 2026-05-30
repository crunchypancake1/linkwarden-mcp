import type { LinkwardenClient } from "../linkwarden/api";
import type { NormalizedDoc, SearchSink } from "../types";
import { INDEXED_IDS_PREFIX } from "../types";

export async function syncCollection(
  collectionId: number,
  client: Pick<LinkwardenClient, "allLinksForCollection">,
  sink: SearchSink,
  kv: KVNamespace,
): Promise<void> {
  const docs: NormalizedDoc[] = [];

  for await (const link of client.allLinksForCollection(collectionId)) {
    docs.push({
      id: `linkwarden:${link.id}`,
      source: "linkwarden",
      title: link.name,
      url: link.url,
      content: link.description?.trim() || link.name,
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
