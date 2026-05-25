export const VOICE_INPUT_SAMPLE_RATE = 16000;
export const VOICE_OUTPUT_SAMPLE_RATE = 24000;
export const VOICE_CAPTURE_BUFFER_SIZE = 2048;
export const VOICE_PLAYBACK_JITTER_SECONDS = 0.08;
export const VOICE_MAX_PLAYBACK_BACKLOG_SECONDS = 1.25;

export function float32ToPcm16(float32: Float32Array): ArrayBuffer {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const sample = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return int16.buffer;
}

export function pcm16ToFloat32(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  const samples = Math.floor(buffer.byteLength / 2);
  const float32 = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const value = view.getInt16(i * 2, true);
    float32[i] = value / (value < 0 ? 0x8000 : 0x7fff);
  }
  return float32;
}

export function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number
): Float32Array {
  if (fromRate === toRate) return input;
  if (input.length === 0) return input;

  const ratio = fromRate / toRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const sourceIndex = i * ratio;
    const left = Math.floor(sourceIndex);
    const right = Math.min(input.length - 1, left + 1);
    const weight = sourceIndex - left;
    output[i] = input[left] * (1 - weight) + input[right] * weight;
  }

  return output;
}

export function nextPlaybackStartTime(
  currentTime: number,
  scheduledUntil: number,
  jitterSeconds = VOICE_PLAYBACK_JITTER_SECONDS,
  maxBacklogSeconds = VOICE_MAX_PLAYBACK_BACKLOG_SECONDS
) {
  const target = currentTime + jitterSeconds;
  if (!scheduledUntil || scheduledUntil <= currentTime) return target;
  if (scheduledUntil - currentTime > maxBacklogSeconds) return target;
  return Math.max(target, scheduledUntil);
}
