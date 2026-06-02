import type { NormalizedDoc, SearchSink } from "../types";

export class R2SearchSink implements SearchSink {
  constructor(private readonly bucket: R2Bucket) {}

  async upsert(docs: NormalizedDoc[]): Promise<void> {
    await Promise.all(
      docs.map((doc) =>
        this.bucket.put(sinkKey(doc.id), JSON.stringify(doc), {
          httpMetadata: { contentType: "application/json" },
        }),
      ),
    );
  }

  async remove(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await Promise.all(ids.map((id) => this.bucket.delete(sinkKey(id))));
  }
}

function sinkKey(id: string): string {
  const bareId = id.replace(/^linkwarden:/, "");
  return `linkwarden/${bareId}.json`;
}
