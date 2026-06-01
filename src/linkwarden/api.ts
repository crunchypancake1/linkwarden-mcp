import type { Collection, Link, LinkPage, SearchParams, Tag } from "../types";

export class LinkwardenClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async rawFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const url = `${this.baseUrl.replace(/\/$/, "")}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        "Authorization": `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`Linkwarden API error: ${res.status} ${res.statusText}`);
    return res;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.rawFetch(path, init);
    const json = await res.json() as { response: T };
    return json.response;
  }

  async searchLinks(params: SearchParams = {}): Promise<LinkPage> {
    const qs = new URLSearchParams();
    if (params.searchQueryString) qs.set("searchQueryString", params.searchQueryString);
    if (params.collectionId != null) qs.set("collectionId", String(params.collectionId));
    if (params.tagName) qs.set("tagName", params.tagName);
    if (params.cursor != null) qs.set("cursor", String(params.cursor));

    const res = await this.rawFetch(`/api/v1/search?${qs}`);
    const json = await res.json() as { response: Link[]; nextCursor?: number | null };
    return { links: json.response ?? [], nextCursor: json.nextCursor ?? null };
  }

  async getLink(id: number): Promise<Link> {
    return this.request<Link>(`/api/v1/links/${id}`);
  }

  async createLink(body: {
    url: string;
    name?: string;
    description?: string;
    collectionId?: number;
    tags?: string[];
  }): Promise<Link> {
    return this.request<Link>("/api/v1/links", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async archiveLink(id: number): Promise<void> {
    await this.request<unknown>(`/api/v1/links/${id}/archive`, { method: "PUT" });
  }

  async getCollections(): Promise<Collection[]> {
    return this.request<Collection[]>("/api/v1/collections");
  }

  async getTags(): Promise<Tag[]> {
    return this.request<Tag[]>("/api/v1/tags");
  }

  async listLinks(params: { collectionId?: number; cursor?: number } = {}): Promise<LinkPage> {
    const qs = new URLSearchParams();
    if (params.collectionId != null) qs.set("collectionId", String(params.collectionId));
    if (params.cursor != null) qs.set("cursor", String(params.cursor));

    const res = await this.rawFetch(`/api/v1/links?${qs}`);
    const json = await res.json() as { response: Link[]; nextCursor?: number | null };
    return { links: json.response ?? [], nextCursor: json.nextCursor ?? null };
  }

  async *allLinksForCollection(collectionId: number): AsyncGenerator<Link> {
    let cursor: number | null = null;
    do {
      const page = await this.listLinks({ collectionId, cursor: cursor ?? undefined });
      for (const link of page.links) yield link;
      cursor = page.nextCursor;
    } while (cursor !== null);
  }
}
