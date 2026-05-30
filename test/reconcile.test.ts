import { describe, it, expect, vi } from "vitest";
import { reconcile } from "../src/indexer/reconcile";
import type { SearchSink } from "../src/types";
import { INDEXED_IDS_PREFIX } from "../src/types";

function makeMockKV(entries: Record<string, string>): KVNamespace {
  return {
    list: vi.fn(async ({ prefix }: { prefix: string }) => ({
      keys: Object.keys(entries)
        .filter((k) => k.startsWith(prefix))
        .map((name) => ({ name })),
      list_complete: true,
      cursor: "",
    })),
    get: vi.fn(async (key: string) => entries[key] ?? null),
    delete: vi.fn(async () => {}),
  } as unknown as KVNamespace;
}

function makeMockSink(): SearchSink & { removed: string[] } {
  const removed: string[] = [];
  return {
    removed,
    upsert: vi.fn(),
    async remove(ids) { removed.push(...ids); },
  };
}

describe("reconcile", () => {
  it("removes docs for collections not in the allowlist", async () => {
    const kv = makeMockKV({
      [`${INDEXED_IDS_PREFIX}1`]: JSON.stringify(["linkwarden:10", "linkwarden:11"]),
      [`${INDEXED_IDS_PREFIX}2`]: JSON.stringify(["linkwarden:20"]),
    });
    const sink = makeMockSink();

    await reconcile([1], sink, kv);

    expect(sink.removed).toContain("linkwarden:20");
    expect(sink.removed).not.toContain("linkwarden:10");
    expect(kv.delete).toHaveBeenCalledWith(`${INDEXED_IDS_PREFIX}2`);
    expect(kv.delete).not.toHaveBeenCalledWith(`${INDEXED_IDS_PREFIX}1`);
  });

  it("does nothing when all indexed collections are in the allowlist", async () => {
    const kv = makeMockKV({
      [`${INDEXED_IDS_PREFIX}5`]: JSON.stringify(["linkwarden:50"]),
    });
    const sink = makeMockSink();

    await reconcile([5, 6], sink, kv);

    expect(sink.removed).toHaveLength(0);
    expect(kv.delete).not.toHaveBeenCalled();
  });

  it("handles empty indexed-ids value gracefully", async () => {
    const kv = makeMockKV({ [`${INDEXED_IDS_PREFIX}3`]: "[]" });
    const sink = makeMockSink();

    await reconcile([], sink, kv);

    expect(sink.removed).toHaveLength(0);
    expect(kv.delete).toHaveBeenCalledWith(`${INDEXED_IDS_PREFIX}3`);
  });
});
