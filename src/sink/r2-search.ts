import type { NormalizedDoc, SearchSink } from "../types";

export class R2SearchSink implements SearchSink {
  constructor(private readonly bucket: R2Bucket) {}

  async upsert(docs: NormalizedDoc[]): Promise<void> {
    await Promise.all(
      docs.map((doc) =>
        this.bucket.put(this.r2Key(doc.id), this.serialize(doc), {
          httpMetadata: { contentType: "text/plain" },
        }),
      ),
    );
  }

  async remove(ids: string[]): Promise<void> {
    await Promise.all(ids.map((id) => this.bucket.delete(this.r2Key(id))));
  }

  private r2Key(docId: string): string {
    const linkId = docId.split(":")[1] ?? docId;
    return `linkwarden/${linkId}.txt`;
  }

  private serialize(doc: NormalizedDoc): string {
    return [
      `Title: ${doc.title}`,
      `URL: ${doc.url ?? ""}`,
      `Collection: ${doc.metadata.collection ?? ""}`,
      `Tags: ${(doc.metadata.tags ?? []).join(", ")}`,
      "",
      doc.content,
    ].join("\n");
  }
}
