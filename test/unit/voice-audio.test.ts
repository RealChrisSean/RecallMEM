import { describe, expect, it } from "vitest";
import {
  VOICE_CAPTURE_BUFFER_SIZE,
  VOICE_INPUT_SAMPLE_RATE,
  VOICE_OUTPUT_SAMPLE_RATE,
  VOICE_PLAYBACK_JITTER_SECONDS,
  float32ToPcm16,
  nextPlaybackStartTime,
  pcm16ToFloat32,
  resampleLinear,
} from "@/lib/voice-audio";

describe("voice audio helpers", () => {
  it("converts float PCM to little-endian signed 16-bit PCM and back", () => {
    const pcm = float32ToPcm16(new Float32Array([-2, -1, -0.5, 0, 0.5, 1, 2]));
    const view = new DataView(pcm);

    expect(view.getInt16(0, true)).toBe(-32768);
    expect(view.getInt16(2, true)).toBe(-32768);
    expect(view.getInt16(6, true)).toBe(0);
    expect(view.getInt16(10, true)).toBe(32767);
    expect(view.getInt16(12, true)).toBe(32767);

    const restored = pcm16ToFloat32(pcm);
    expect(restored[1]).toBeCloseTo(-1, 4);
    expect(restored[3]).toBe(0);
    expect(restored[5]).toBeCloseTo(1, 4);
  });

  it("uses linear resampling so mic audio is not nearest-neighbor stepped", () => {
    const input = new Float32Array([0, 1]);
    const output = resampleLinear(input, 2, 4);

    expect([...output]).toEqual([0, 0.5, 1, 1]);
  });

  it("keeps capture chunks short enough for realtime voice", () => {
    expect(VOICE_INPUT_SAMPLE_RATE).toBe(16000);
    expect(VOICE_OUTPUT_SAMPLE_RATE).toBe(24000);
    expect(VOICE_CAPTURE_BUFFER_SIZE).toBe(2048);
    expect((VOICE_CAPTURE_BUFFER_SIZE / 48000) * 1000).toBeLessThan(45);
    expect((VOICE_CAPTURE_BUFFER_SIZE / VOICE_INPUT_SAMPLE_RATE) * 1000).toBeLessThan(130);
  });

  it("adds a small jitter buffer and preserves continuous playback", () => {
    expect(VOICE_PLAYBACK_JITTER_SECONDS).toBeGreaterThanOrEqual(0.05);
    expect(VOICE_PLAYBACK_JITTER_SECONDS).toBeLessThanOrEqual(0.12);

    expect(nextPlaybackStartTime(10, 0)).toBeCloseTo(10 + VOICE_PLAYBACK_JITTER_SECONDS);
    expect(nextPlaybackStartTime(10, 10.5)).toBeCloseTo(10.5);
    expect(nextPlaybackStartTime(10, 9.9)).toBeCloseTo(10 + VOICE_PLAYBACK_JITTER_SECONDS);
  });

  it("never schedules new chunks on top of already queued playback", () => {
    expect(nextPlaybackStartTime(10, 12)).toBeCloseTo(12);
  });
});
