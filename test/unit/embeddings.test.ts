import { describe, expect, it } from "vitest";
import { embeddingColumnForSource } from "@/lib/embeddings";

describe("embeddingColumnForSource", () => {
  it("uses the OpenAI 256-dim column for OpenAI embeddings", () => {
    expect(embeddingColumnForSource("openai")).toBe("embedding_oai");
  });

  it("uses the Ollama 768-dim column for Ollama embeddings", () => {
    expect(embeddingColumnForSource("ollama")).toBe("embedding");
  });
});
