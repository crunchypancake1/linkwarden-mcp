import { describe, it, expect, vi } from "vitest";
import { processR2Event } from "../../src/indexer/event";
import type { Env, NormalizedDoc, Link, ReadabilityContent } from "../../src/types";
import { INDEXED_COLLECTIONS_KEY } from "../../src/types";

function makeLink(id: number, collectionId = 5): Link {
  return {
    id,
    name: `Link ${id}`,
    url: `https://example.com/${id}`,
    description: `desc ${id}`,
    collectionId,
    collection: { id: collectionId, name: "My Collection" },
    tags: [{ id: 1, name: "tag1" }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  };
}

const READABILITY: ReadabilityContent = {
  title: "Article Title",
  textContent: "This is the full article text.",
  content: "<p>This is the full article text.</p>",
  excerpt: "This is the full",
  byline: null,
  siteName: "Example",
  length: 30,
};

function makeEnv(): Env {
  const allowlist = JSON.stringify({ mode: "allowlist", collectionIds: [5] });
  const kvStore = new Map<string, string>([[INDEXED_COLLECTIONS_KEY, allowlist]]);

  return {
    LINKWARDEN_URL: "https://linkwarden.example.com",
    LINKWARDEN_TOKEN: "token",
    SINK_BUCKET: {
      put: vi.fn(),
      delete: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
      head: vi.fn(),
      createMultipartUpload: vi.fn(),
      resumeMultipartUpload: vi.fn(),
    } as unknown as R2Bucket,
    LINKWARDEN_DATA: {
      get: vi.fn(async (_key: string) => ({
        json: async () => READABILITY,
      })),
    } as unknown as R2Bucket,
    KV: {
      get: vi.fn(async (key: string) => kvStore.get(key) ?? null),
      put: vi.fn(),
    } as unknown as KVNamespace,
    AI: {} as Ai,
    AI_SEARCH_INSTANCE: "personal-search",
    LINKWARDEN_MCP: {} as DurableObjectNamespace,
  };
}

function mockFetchLink(link: Link) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ response: link }),
  } as Response);
}

describe("processR2Event", () => {
  it("skips non-readability files (PDF)", async () => {
    const env = makeEnv();
    await processR2Event("archives/5/1234.pdf", "PutObject", env);
    expect(env.LINKWARDEN_DATA.get).not.toHaveBeenCalled();
  });

  it("skips non-readability files (screenshot)", async () => {
    const env = makeEnv();
    await processR2Event("archives/5/1234.png", "PutObject", env);
    expect(env.LINKWARDEN_DATA.get).not.toHaveBeenCalled();
  });

  it("removes doc from sink on DeleteObject", async () => {
    const env = makeEnv();
    const deleted: string[] = [];
    env.SINK_BUCKET = {
      put: vi.fn(),
      delete: vi.fn(async (key: string) => { deleted.push(key); }),
      get: vi.fn(),
      list: vi.fn(),
      head: vi.fn(),
      createMultipartUpload: vi.fn(),
      resumeMultipartUpload: vi.fn(),
    } as unknown as R2Bucket;

    await processR2Event("archives/5/1234_readability.json", "DeleteObject", env);

    expect(deleted).toContain("linkwarden/1234.json");
  });

  it("skips PutObject when collection is not in allowlist", async () => {
    const env = makeEnv();
    // archives/99/... — collectionId 99 is not in allowlist [5]
    await processR2Event("archives/99/1234_readability.json", "PutObject", env);
    expect(env.LINKWARDEN_DATA.get).not.toHaveBeenCalled();
  });

  it("upserts a normalized doc with readability content on PutObject", async () => {
    const env = makeEnv();
    const upserted: NormalizedDoc[] = [];
    env.SINK_BUCKET = {
      put: vi.fn(async (_key: string, body: string) => {
        upserted.push(JSON.parse(body) as NormalizedDoc);
      }),
      delete: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
      head: vi.fn(),
      createMultipartUpload: vi.fn(),
      resumeMultipartUpload: vi.fn(),
    } as unknown as R2Bucket;

    mockFetchLink(makeLink(1234, 5));

    await processR2Event("archives/5/1234_readability.json", "PutObject", env);

    expect(upserted).toHaveLength(1);
    const doc = upserted[0]!;
    expect(doc.id).toBe("linkwarden:1234");
    expect(doc.source).toBe("linkwarden");
    expect(doc.title).toBe("Link 1234");
    expect(doc.url).toBe("https://example.com/1234");
    expect(doc.content).toBe("This is the full article text.");
    expect(doc.metadata.collection).toBe("My Collection");
    expect(doc.metadata.tags).toEqual(["tag1"]);
  });

  it("skips upsert when readability file is missing from R2", async () => {
    const env = makeEnv();
    env.LINKWARDEN_DATA = {
      get: vi.fn(async () => null),
    } as unknown as R2Bucket;
    const upserted: NormalizedDoc[] = [];
    env.SINK_BUCKET = {
      put: vi.fn(async (_key: string, body: string) => { upserted.push(JSON.parse(body) as NormalizedDoc); }),
      delete: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
      head: vi.fn(),
      createMultipartUpload: vi.fn(),
      resumeMultipartUpload: vi.fn(),
    } as unknown as R2Bucket;

    mockFetchLink(makeLink(1234, 5));
    await processR2Event("archives/5/1234_readability.json", "PutObject", env);
    expect(upserted).toHaveLength(0);
  });

  it("skips upsert when API fetch fails", async () => {
    const env = makeEnv();
    const upserted: NormalizedDoc[] = [];
    env.SINK_BUCKET = {
      put: vi.fn(async (_key: string, body: string) => { upserted.push(JSON.parse(body) as NormalizedDoc); }),
      delete: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
      head: vi.fn(),
      createMultipartUpload: vi.fn(),
      resumeMultipartUpload: vi.fn(),
    } as unknown as R2Bucket;

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    } as Response);

    await processR2Event("archives/5/1234_readability.json", "PutObject", env);
    expect(upserted).toHaveLength(0);
  });

  it("falls back to API description when readability textContent is empty", async () => {
    const env = makeEnv();
    const upserted: NormalizedDoc[] = [];
    env.SINK_BUCKET = {
      put: vi.fn(async (_key: string, body: string) => {
        upserted.push(JSON.parse(body) as NormalizedDoc);
      }),
      delete: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
      head: vi.fn(),
      createMultipartUpload: vi.fn(),
      resumeMultipartUpload: vi.fn(),
    } as unknown as R2Bucket;

    env.LINKWARDEN_DATA = {
      get: vi.fn(async () => ({
        json: async () => ({
          title: "Article",
          textContent: "",   // empty — should fall back
          content: "",
          excerpt: "",
          byline: null,
          siteName: null,
          length: 0,
        }),
      })),
    } as unknown as R2Bucket;

    mockFetchLink(makeLink(1234, 5));  // makeLink sets description to "desc 1234"

    await processR2Event("archives/5/1234_readability.json", "PutObject", env);

    expect(upserted[0]!.content).toBe("desc 1234");
  });
});
