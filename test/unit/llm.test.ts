import { describe, expect, it } from "vitest";
import {
  anthropicAdaptiveEffortForMode,
  anthropicAdaptiveRequestOptionsForModel,
  detectImageMediaType,
  openaiReasoningEffortForMode,
  openaiResponsesOutputText,
  openaiResponsesRequestBody,
} from "@/lib/llm";

describe("detectImageMediaType", () => {
  it("detects JPEG bytes even when the file was originally uploaded as PNG", () => {
    expect(detectImageMediaType("/9j/4AAQSkZJRgABAQAAAQABAAD/2w==")).toBe("image/jpeg");
  });

  it("detects PNG bytes", () => {
    expect(detectImageMediaType("iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB")).toBe("image/png");
  });

  it("uses a supported data URL media type when bytes are unknown", () => {
    expect(detectImageMediaType("data:image/webp;base64,unknown")).toBe("image/webp");
  });
});

describe("provider model modes", () => {
  it("maps OpenAI chat modes to reasoning effort", () => {
    expect(openaiReasoningEffortForMode("openai", "gpt-5.6-sol", "instant")).toBe("none");
    expect(openaiReasoningEffortForMode("openai", "gpt-5.6-sol", "openai-thinking")).toBe("medium");
    expect(openaiReasoningEffortForMode("openai", "gpt-5.6-sol", "openai-deep")).toBe("xhigh");
    expect(openaiReasoningEffortForMode("openai", "gpt-5.6-sol", "openai-max")).toBe("max");
  });

  it("does not send OpenAI reasoning options to compatible providers", () => {
    expect(openaiReasoningEffortForMode("openai-compatible", "gpt-5.5", "openai-deep")).toBeNull();
  });

  it("maps Claude adaptive modes to output effort", () => {
    expect(anthropicAdaptiveEffortForMode("anthropic-adaptive-low")).toBe("low");
    expect(anthropicAdaptiveEffortForMode("anthropic-adaptive-medium")).toBe("medium");
    expect(anthropicAdaptiveEffortForMode("anthropic-adaptive-high")).toBe("high");
    expect(anthropicAdaptiveEffortForMode("anthropic-adaptive-xhigh")).toBe("xhigh");
    expect(anthropicAdaptiveEffortForMode("anthropic-adaptive-max")).toBe("max");
    expect(anthropicAdaptiveEffortForMode("instant")).toBeNull();
  });

  it("uses output_config effort without explicit thinking config for Claude Fable 5.1", () => {
    expect(
      anthropicAdaptiveRequestOptionsForModel("claude-fable-5-1", "anthropic-adaptive-high")
    ).toEqual({ output_config: { effort: "high" } });
  });

  it("keeps explicit adaptive thinking config for non-Fable Claude models", () => {
    expect(
      anthropicAdaptiveRequestOptionsForModel("claude-opus-5", "anthropic-adaptive-high")
    ).toEqual({
      thinking: { type: "adaptive", display: "omitted" },
      output_config: { effort: "high" },
    });
  });
});

describe("OpenAI Responses API", () => {
  it("builds private streaming requests with reasoning and image input", () => {
    const body = JSON.parse(openaiResponsesRequestBody(
      "gpt-5.6-terra",
      [{ role: "user", content: "Describe this", images: ["/9j/4AAQ"] }],
      true,
      "openai-deep"
    ));

    expect(body).toMatchObject({
      model: "gpt-5.6-terra",
      stream: true,
      store: false,
      reasoning: { effort: "xhigh" },
    });
    expect(body.input[0].content).toEqual([
      { type: "input_image", image_url: "data:image/jpeg;base64,/9j/4AAQ" },
      { type: "input_text", text: "Describe this" },
    ]);
  });

  it("extracts only visible output text from non-streaming responses", () => {
    expect(openaiResponsesOutputText({
      output: [
        { content: [{ type: "reasoning", text: "hidden" }] },
        { content: [{ type: "output_text", text: "Visible answer" }] },
      ],
    })).toBe("Visible answer");
  });
});
