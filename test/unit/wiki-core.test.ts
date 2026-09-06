import { describe, expect, it } from "vitest";
import {
  chunkSourceText,
  citationLabel,
  normalizeBrainName,
  validateWikiCitations,
} from "@/lib/wiki-core";

describe("wiki source chunking", () => {
  it("chunks source text with stable line ranges", () => {
    const chunks = chunkSourceText(
      [
        "# Example Service",
        "The service has source-grounded documentation.",
        "",
        "## Checkpoints",
        "A checkpoint captures state.",
        "A restore returns to that checkpoint.",
      ].join("\n"),
      { maxChars: 80 }
    );

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].lineStart).toBe(1);
    expect(chunks[0].lineEnd).toBeGreaterThanOrEqual(2);
    expect(chunks.at(-1)?.sectionTitle).toBe("Checkpoints");
  });

  it("normalizes brain names for source namespaces", () => {
    expect(normalizeBrainName("Project Wiki")).toBe("project-wiki");
    expect(normalizeBrainName("")).toBe("default");
  });
});

describe("wiki citation validation", () => {
  const chunk = {
    id: "chunk-1",
    chunk_text: ["The service keeps state.", "Checkpoints preserve machine state."].join("\n"),
    line_start: 10,
    line_end: 11,
    citation: citationLabel({
      sourceTitle: "example/project-docs",
      sourceRef: "abcdef1234567890",
      path: "docs/checkpoints.md",
      lineStart: 10,
      lineEnd: 11,
    }),
  };

  it("accepts citations that point to real chunk lines and exact quote text", () => {
    const valid = validateWikiCitations(
      [
        {
          marker: "C1",
          chunkId: "chunk-1",
          lineStart: 11,
          lineEnd: 11,
          quote: "Checkpoints preserve machine state.",
        },
      ],
      [chunk]
    );

    expect(valid).toHaveLength(1);
    expect(valid[0].citation).toBe("example/project-docs@abcdef123456 docs/checkpoints.md:L11-L11");
  });

  it("rejects citations whose quote is not in the cited lines", () => {
    const valid = validateWikiCitations(
      [
        {
          marker: "C1",
          chunkId: "chunk-1",
          lineStart: 10,
          lineEnd: 10,
          quote: "The service secretly uses an undocumented scheduler.",
        },
      ],
      [chunk]
    );

    expect(valid).toEqual([]);
  });

  it("rejects citations outside the stored chunk range", () => {
    const valid = validateWikiCitations(
      [
        {
          marker: "C1",
          chunkId: "chunk-1",
          lineStart: 9,
          lineEnd: 11,
          quote: "The service keeps state.",
        },
      ],
      [chunk]
    );

    expect(valid).toEqual([]);
  });
});
