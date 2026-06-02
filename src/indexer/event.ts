import { LinkwardenClient } from "../linkwarden/api";
import { R2SearchSink } from "../sink/r2-search";
import { loadCollectionConfig } from "./config";
import { parseArchiveKey } from "./archive";
import type { Env, Link, NormalizedDoc, ReadabilityContent } from "../types";

export async function processR2Event(
  key: string,
  action: string,
  env: Env,
): Promise<void> {
  const parts = parseArchiveKey(key);
  if (!parts) return;

  const sink = new R2SearchSink(env.SINK_BUCKET);
  const docId = `linkwarden:${parts.linkId}`;

  if (action === "DeleteObject") {
    await sink.remove([docId]);
    return;
  }

  const config = await loadCollectionConfig(env.KV);
  if (!config.collectionIds.includes(parts.collectionId)) return;

  const r2obj = await env.LINKWARDEN_DATA.get(key);
  if (!r2obj) return;

  const readability = await r2obj.json<ReadabilityContent>();

  const client = new LinkwardenClient(env.LINKWARDEN_URL, env.LINKWARDEN_TOKEN);
  let link: Link;
  try {
    link = await client.getLink(parts.linkId);
  } catch {
    console.warn(`[linkwarden-indexer] Failed to fetch link ${parts.linkId}, skipping`);
    return;
  }

  await sink.upsert([normalizeLink(link, readability)]);
  console.log(`[linkwarden-indexer] upserted linkId=${parts.linkId}`);
}

function normalizeLink(link: Link, readability: ReadabilityContent): NormalizedDoc {
  return {
    id: `linkwarden:${link.id}`,
    source: "linkwarden",
    title: link.name,
    url: link.url,
    content:
      readability.textContent?.trim() ||
      link.textContent?.trim() ||
      link.description?.trim() ||
      link.name,
    metadata: {
      collection: link.collection?.name,
      tags: link.tags?.map((t) => t.name),
      createdAt: link.createdAt,
      updatedAt: link.updatedAt,
    },
  };
}
