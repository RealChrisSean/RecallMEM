import { describe, expect, it } from "vitest";
import { detectImageMediaType } from "@/lib/llm";

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
