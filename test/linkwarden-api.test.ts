import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinkwardenClient } from "../src/linkwarden/api";
import type { Link, Collection, Tag } from "../src/types";

const BASE_URL = "https://lw.example.com";
const TOKEN = "tok-test";

function makeLink(id: number, extras: Partial<Link> = {}): Link {
  return { id, name: `Link ${id}`, url: `https://example.com/${id}`, ...extras };
}

describe("LinkwardenClient", () => {
  let client: LinkwardenClient;

  beforeEach(() => {
    client = new LinkwardenClient(BASE_URL, TOKEN);
    vi.restoreAllMocks();
  });

  it("searchLinks attaches bearer token and query params", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ response: [makeLink(1)], nextCursor: null }), { status: 200 })
    );

    const result = await client.searchLinks({ searchQueryString: "test", collectionId: 5 });

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/search");
    expect(url).toContain("searchQueryString=test");
    expect(url).toContain("collectionId=5");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok-test");
    expect(result.links).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  it("getLink fetches a single link by ID", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ response: makeLink(42) }), { status: 200 })
    );
    const link = await client.getLink(42);
    const [url] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/links/42");
    expect(link.id).toBe(42);
  });

  it("createLink POSTs with body", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ response: makeLink(99) }), { status: 200 })
    );
    const link = await client.createLink({ url: "https://x.com", name: "X", collectionId: 1 });
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(link.id).toBe(99);
  });

  it("getCollections returns array", async () => {
    const cols: Collection[] = [{ id: 1, name: "Inbox" }];
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ response: cols }), { status: 200 })
    );
    const result = await client.getCollections();
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("Inbox");
  });

  it("getTags unwraps the data.tags envelope", async () => {
    const tags: Tag[] = [{ id: 1, name: "login" }];
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { tags } }), { status: 200 })
    );
    const result = await client.getTags();
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("login");
  });

  it("allLinksForCollection pages through all links", async () => {
    const spy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ response: [makeLink(1)], nextCursor: 1 }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ response: [makeLink(2)], nextCursor: null }), { status: 200 })
      );

    const collected: Link[] = [];
    for await (const link of client.allLinksForCollection(5)) {
      collected.push(link);
    }

    expect(collected).toHaveLength(2);
    expect(spy).toHaveBeenCalledTimes(2);
    const secondUrl = spy.mock.calls[1]?.[0] as string;
    expect(secondUrl).toContain("cursor=1");
  });

  it("throws on non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 })
    );
    await expect(client.getLink(1)).rejects.toThrow("Linkwarden API error: 401");
  });
});
