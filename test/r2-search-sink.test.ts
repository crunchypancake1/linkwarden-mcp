import { describe, it, expect, vi } from "vitest";
import { R2SearchSink } from "../src/sink/r2-search";
import type { NormalizedDoc } from "../src/types";

function makeDoc(id: string, extras: Partial<NormalizedDoc> = {}): NormalizedDoc {
  return {
    id,
    source: "linkwarden",
    title: "Test",
    url: "https://example.com",
    content: "some content",
    metadata: { collection: "Inbox", tags: ["a"] },
    ...extras,
  };
}

function makeMockBucket() {
  return {
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  } as unknown as R2Bucket;
}

describe("R2SearchSink", () => {
  it("upsert writes each doc as a JSON file with the correct key", async () => {
    const bucket = makeMockBucket();
    const sink = new R2SearchSink(bucket);

    await sink.upsert([makeDoc("linkwarden:42"), makeDoc("linkwarden:7")]);

    expect(bucket.put).toHaveBeenCalledTimes(2);
    const calls = (bucket.put as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]![0]).toBe("linkwarden/42.json");
    expect(calls[0]![1]).toContain('"title":"Test"');
    expect(calls[0]![1]).toContain('"content":"some content"');
    expect(calls[0]![2]).toEqual({ httpMetadata: { contentType: "application/json" } });
    expect(calls[1]![0]).toBe("linkwarden/7.json");
  });

  it("remove deletes each R2 object by derived key", async () => {
    const bucket = makeMockBucket();
    const sink = new R2SearchSink(bucket);

    await sink.remove(["linkwarden:10", "linkwarden:20"]);

    const calls = (bucket.delete as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]![0]).toBe("linkwarden/10.json");
    expect(calls[1]![0]).toBe("linkwarden/20.json");
  });

  it("serialized content includes all metadata fields", async () => {
    const bucket = makeMockBucket();
    const sink = new R2SearchSink(bucket);
    const doc = makeDoc("linkwarden:1", {
      title: "My Link",
      url: "https://example.com/1",
      content: "readable text",
      metadata: { collection: "Research", tags: ["ai", "ml"] },
    });

    await sink.upsert([doc]);

    const body = (bucket.put as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string;
    expect(body).toContain('"title":"My Link"');
    expect(body).toContain('"url":"https://example.com/1"');
    expect(body).toContain('"collection":"Research"');
    expect(body).toContain('"tags":["ai","ml"]');
    expect(body).toContain('"content":"readable text"');
  });
});
