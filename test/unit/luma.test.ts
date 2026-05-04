import { describe, expect, it } from "vitest";
import { normalizeLumaCreateInput } from "@/lib/luma";

describe("normalizeLumaCreateInput", () => {
  it("accepts the default text-to-image request", () => {
    expect(normalizeLumaCreateInput({ prompt: "A quiet library at sunrise" })).toEqual({
      prompt: "A quiet library at sunrise",
      type: "image",
      aspectRatio: null,
      style: "auto",
      outputFormat: null,
      webSearch: false,
      source: null,
      imageRef: [],
    });
  });

  it("normalizes supported options from client field names", () => {
    expect(normalizeLumaCreateInput({
      prompt: "A manga panel of a city rooftop",
      aspectRatio: "2:3",
      style: "manga",
      outputFormat: "png",
      webSearch: true,
    })).toEqual({
      prompt: "A manga panel of a city rooftop",
      type: "image",
      aspectRatio: "2:3",
      style: "manga",
      outputFormat: "png",
      webSearch: true,
      source: null,
      imageRef: [],
    });
  });

  it("switches to image_edit when a source image is provided", () => {
    expect(normalizeLumaCreateInput({
      prompt: "Turn this into a product photo",
      source: { data: "abc123", media_type: "image/jpeg" },
      imageRef: [{ data: "def456", media_type: "image/png" }],
    })).toEqual({
      prompt: "Turn this into a product photo",
      type: "image_edit",
      aspectRatio: null,
      style: "auto",
      outputFormat: null,
      webSearch: false,
      source: { data: "abc123", media_type: "image/jpeg" },
      imageRef: [{ data: "def456", media_type: "image/png" }],
    });
  });

  it("rejects invalid generation options before calling Luma", () => {
    expect(() => normalizeLumaCreateInput({ prompt: "", aspectRatio: "1:1" }))
      .toThrow("Prompt must be between 1 and 6000 characters");
    expect(() => normalizeLumaCreateInput({ prompt: "x", aspectRatio: "4:3" }))
      .toThrow("Invalid aspect ratio");
    expect(() => normalizeLumaCreateInput({ prompt: "x", style: "oil" }))
      .toThrow("Invalid style");
    expect(() => normalizeLumaCreateInput({ prompt: "x", outputFormat: "gif" }))
      .toThrow("Invalid output format");
    expect(() => normalizeLumaCreateInput({ prompt: "x", source: { data: "abc" } }))
      .toThrow("source: media_type is required with data");
  });
});
