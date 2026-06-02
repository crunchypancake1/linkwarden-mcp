export interface Env {
  LINKWARDEN_MCP: DurableObjectNamespace;
  KV: KVNamespace;
  SINK_BUCKET: R2Bucket;
  // R2 bucket: Linkwarden's preserved content (read-only by this Worker)
  LINKWARDEN_DATA: R2Bucket;
  AI: Ai;
  LINKWARDEN_URL: string;
  LINKWARDEN_TOKEN: string;
  AI_SEARCH_INSTANCE: string;
}

export interface CollectionConfig {
  mode: "allowlist";
  collectionIds: number[];
}

export const INDEXED_COLLECTIONS_KEY = "config:indexed-collections";
export const INDEXED_IDS_PREFIX = "indexed-ids:";

export interface NormalizedDoc {
  id: string;       // "linkwarden:123"
  source: "linkwarden";
  title: string;
  url?: string;
  content: string;
  metadata: {
    collection?: string;
    tags?: string[];
    createdAt?: string;
    updatedAt?: string;
  };
}

export interface SearchSink {
  upsert(docs: NormalizedDoc[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
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

// Shape of message body Cloudflare R2 sends to a Queue on object change
export interface R2EventNotificationMessage {
  account: string;
  bucket: string;
  object: {
    key: string;
    size: number;
    eTag: string;
  };
  action: "PutObject" | "DeleteObject" | "CopyObject" | "CompleteMultipartUpload";
  eventTime: string;
}

// Mozilla Readability article object stored by Linkwarden at archives/{collectionId}/{linkId}_readability.json
export interface ReadabilityContent {
  title: string;
  textContent: string;
  content: string;
  excerpt: string;
  byline: string | null;
  siteName: string | null;
  length: number;
}
