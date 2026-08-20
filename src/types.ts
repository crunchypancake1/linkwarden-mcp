export interface Env {
  LINKWARDEN_MCP: DurableObjectNamespace;
  /** Workers VPC service binding pointing at the Linkwarden host. */
  LINKWARDEN_VPC: Fetcher;
  /** Only supplies the URL/Host header; the VPC service decides where the request goes. */
  LINKWARDEN_URL: string;
  LINKWARDEN_TOKEN: SecretsStoreSecret;
}

export interface LinkTag {
  id: number;
  name: string;
}

export interface Link {
  id: number;
  name: string;
  url: string;
  description?: string;
  textContent?: string;
  collectionId?: number;
  collection?: { id: number; name: string };
  tags?: LinkTag[];
  createdAt?: string;
  updatedAt?: string;
}

export interface LinkPage {
  links: Link[];
  nextCursor: number | null;
}

export interface Collection {
  id: number;
  name: string;
  description?: string;
}

export interface Tag {
  id: number;
  name: string;
}

export interface SearchParams {
  searchQueryString?: string;
  collectionId?: number;
  tagName?: string;
  cursor?: number;
}
