export interface ArchiveKeyParts {
  collectionId: number;
  linkId: number;
}

const READABILITY_RE = /^archives\/(\d+)\/(\d+)_readability\.json$/;

export function parseArchiveKey(key: string): ArchiveKeyParts | null {
  const match = READABILITY_RE.exec(key);
  if (!match) return null;
  return {
    collectionId: parseInt(match[1]!, 10),
    linkId: parseInt(match[2]!, 10),
  };
}

export function readabilityKey(collectionId: number, linkId: number): string {
  return `archives/${collectionId}/${linkId}_readability.json`;
}
