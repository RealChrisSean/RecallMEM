import { describe, expect, it } from "vitest";
import {
  anthropicAdaptiveEffortForMode,
  detectImageMediaType,
  openaiReasoningEffortForMode,
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
    expect(openaiReasoningEffortForMode("openai", "gpt-5.5", "instant")).toBe("none");
    expect(openaiReasoningEffortForMode("openai", "gpt-5.5", "openai-thinking")).toBe("medium");
    expect(openaiReasoningEffortForMode("openai", "gpt-5.5", "openai-deep")).toBe("xhigh");
    expect(openaiReasoningEffortForMode("openai", "gpt-5.5-pro", "openai-pro")).toBe("xhigh");
  });

  it("does not send OpenAI reasoning options to compatible providers", () => {
    expect(openaiReasoningEffortForMode("openai-compatible", "gpt-5.5", "openai-deep")).toBeNull();
  });

  it("maps Claude adaptive modes to output effort", () => {
    expect(anthropicAdaptiveEffortForMode("anthropic-adaptive-low")).toBe("low");
    expect(anthropicAdaptiveEffortForMode("anthropic-adaptive-medium")).toBe("medium");
    expect(anthropicAdaptiveEffortForMode("anthropic-adaptive-high")).toBe("high");
    expect(anthropicAdaptiveEffortForMode("anthropic-adaptive-xhigh")).toBe("xhigh");
    expect(anthropicAdaptiveEffortForMode("instant")).toBeNull();
  });
});
