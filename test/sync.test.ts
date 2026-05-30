import { describe, it, expect, vi } from "vitest";
import { syncCollection } from "../src/indexer/sync";
import type { Link, SearchSink, NormalizedDoc } from "../src/types";
import { INDEXED_IDS_PREFIX } from "../src/types";

function makeLink(id: number, collectionId = 1): Link {
  return {
    id,
    name: `Link ${id}`,
    url: `https://example.com/${id}`,
    description: `desc ${id}`,
    collectionId,
    collection: { id: collectionId, name: "Test" },
    tags: [{ id: 1, name: "tag1" }],
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeMockClient(links: Link[]) {
  return {
    async *allLinksForCollection(_collectionId: number) {
      for (const l of links) yield l;
    },
  };
}

function makeMockSink(): SearchSink & { upserted: NormalizedDoc[]; removed: string[] } {
  const upserted: NormalizedDoc[] = [];
  const removed: string[] = [];
  return {
    upserted,
    removed,
    async upsert(docs) { upserted.push(...docs); },
    async remove(ids) { removed.push(...ids); },
  };
}

function makeMockKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
  } as unknown as KVNamespace;
}

describe("syncCollection", () => {
  it("normalizes links into NormalizedDocs and upserts them", async () => {
    const client = makeMockClient([makeLink(1), makeLink(2)]);
    const sink = makeMockSink();
    const kv = makeMockKV();

    await syncCollection(1, client, sink, kv);

    expect(sink.upserted).toHaveLength(2);
    const doc = sink.upserted[0]!;
    expect(doc.id).toBe("linkwarden:1");
    expect(doc.source).toBe("linkwarden");
    expect(doc.title).toBe("Link 1");
    expect(doc.url).toBe("https://example.com/1");
    expect(doc.content).toBe("desc 1");
    expect(doc.metadata.collection).toBe("Test");
    expect(doc.metadata.tags).toEqual(["tag1"]);
  });

  it("writes indexed IDs to KV after successful upsert", async () => {
    const client = makeMockClient([makeLink(10), makeLink(20)]);
    const sink = makeMockSink();
    const kv = makeMockKV();

    await syncCollection(1, client, sink, kv);

    expect(kv.put).toHaveBeenCalledWith(
      `${INDEXED_IDS_PREFIX}1`,
      JSON.stringify(["linkwarden:10", "linkwarden:20"]),
    );
  });

  it("falls back to link name when description is absent", async () => {
    const link: Link = { id: 5, name: "No Desc", url: "https://x.com" };
    const client = makeMockClient([link]);
    const sink = makeMockSink();
    const kv = makeMockKV();

    await syncCollection(1, client, sink, kv);

    expect(sink.upserted[0]!.content).toBe("No Desc");
  });

  it("does not write KV if upsert throws", async () => {
    const client = makeMockClient([makeLink(1)]);
    const failSink: SearchSink = {
      upsert: vi.fn().mockRejectedValue(new Error("R2 error")),
      remove: vi.fn(),
    };
    const kv = makeMockKV();

    await expect(syncCollection(1, client, failSink, kv)).rejects.toThrow("R2 error");
    expect(kv.put).not.toHaveBeenCalled();
  });
});
