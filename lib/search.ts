export type MemoryMatchReason = "semantic" | "keyword" | "receipt";

export function sqlLikePattern(input: string): string {
  const escaped = input.replace(/[\\%_]/g, (match) => `\\${match}`);
  return `%${escaped}%`;
}
