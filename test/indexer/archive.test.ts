import { describe, it, expect } from "vitest";
import { parseArchiveKey, readabilityKey } from "../../src/indexer/archive";

describe("parseArchiveKey", () => {
  it("parses a valid readability key", () => {
    const result = parseArchiveKey("archives/5/1234_readability.json");
    expect(result).toEqual({ collectionId: 5, linkId: 1234 });
  });

  it("returns null for a PDF file", () => {
    expect(parseArchiveKey("archives/5/1234.pdf")).toBeNull();
  });

  it("returns null for a PNG file", () => {
    expect(parseArchiveKey("archives/5/1234.png")).toBeNull();
  });

  it("returns null for an HTML file", () => {
    expect(parseArchiveKey("archives/5/1234.html")).toBeNull();
  });

  it("returns null for an unrelated path", () => {
    expect(parseArchiveKey("some/other/file.json")).toBeNull();
  });

  it("returns null for the preview subdirectory", () => {
    expect(parseArchiveKey("archives/preview/5/1234.png")).toBeNull();
  });

  it("returns null for a directory listing path", () => {
    expect(parseArchiveKey("archives/5/")).toBeNull();
  });
});

describe("readabilityKey", () => {
  it("constructs the correct key", () => {
    expect(readabilityKey(5, 1234)).toBe("archives/5/1234_readability.json");
  });
});
