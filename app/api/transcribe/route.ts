import { NextRequest } from "next/server";
import { execSync } from "child_process";
import { writeFileSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { getSetting } from "@/lib/settings";
import { logUsage } from "@/lib/usage";

export const runtime = "nodejs";

/**
 * POST /api/transcribe
 *
 * Receives audio (WAV/webm) from the browser mic recorder.
 *
 * If the user has a Deepgram API key and STT set to "deepgram",
 * uses Deepgram Nova-3 for transcription (cloud, very accurate).
 *
 * Otherwise falls back to local whisper-server on localhost:8178
 * (free, private, runs on your machine).
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("audio");

    if (!file || !(file instanceof Blob)) {
      return json({ error: "audio file required" }, 400);
    }

    const sttProvider = await getSetting("stt_provider");
    const deepgramKey = await getSetting("deepgram_api_key");

    // --- Deepgram STT ---
    if (sttProvider === "deepgram" && deepgramKey) {
      const arrayBuffer = await file.arrayBuffer();
      const res = await fetch("https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true", {
        method: "POST",
        headers: {
          Authorization: `Token ${deepgramKey}`,
          "Content-Type": file.type || "audio/webm",
        },
        body: Buffer.from(arrayBuffer),
      });

      if (!res.ok) {
        console.error(`[transcribe] Deepgram returned ${res.status}: ${await res.text()}`);
        return json({ error: `Deepgram error: ${res.status}` }, 502);
      }

      const data = (await res.json()) as {
        results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
        metadata?: { duration?: number };
      };
      const text = data.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
      // Log usage — duration from Deepgram response, or estimate 3s per chunk
      const durationMs = (data.metadata?.duration || 3) * 1000;
      logUsage({ provider: "deepgram", service: "stt", model: "nova-3", units: Math.round(durationMs), unitType: "ms" });
      return json({ text: text.trim() });
    }

    // --- Local Whisper STT (default) ---
    const whisperUrl = process.env.WHISPER_URL || "http://localhost:8178";

    // Browser MediaRecorder outputs webm/opus. Whisper.cpp needs WAV.
    const id = randomUUID();
    const inputPath = join(tmpdir(), `recallmem-${id}.webm`);
    const outputPath = join(tmpdir(), `recallmem-${id}.wav`);

    const arrayBuffer = await file.arrayBuffer();
    writeFileSync(inputPath, Buffer.from(arrayBuffer));

    try {
      execSync(
        `ffmpeg -y -i "${inputPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${outputPath}" 2>/dev/null`,
        { timeout: 10000 }
      );
    } catch {
      unlinkSync(inputPath);
      return json({ error: "Failed to convert audio. Is ffmpeg installed?" }, 500);
    }

    const wavBuffer = readFileSync(outputPath);
    unlinkSync(inputPath);
    unlinkSync(outputPath);

    const wavBlob = new Blob([wavBuffer], { type: "audio/wav" });

    const whisperForm = new FormData();
    whisperForm.append("file", wavBlob, "audio.wav");
    whisperForm.append("response_format", "json");
    whisperForm.append("temperature", "0.0");

    const res = await fetch(`${whisperUrl}/inference`, {
      method: "POST",
      body: whisperForm,
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[transcribe] whisper-server returned ${res.status}: ${text}`);
      return json({ error: `Whisper server error: ${res.status}` }, 502);
    }

    const data = (await res.json()) as { text?: string };
    const text = (data.text || "").trim();

    return json({ text });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("ECONNREFUSED")) {
      return json(
        {
          error:
            "Whisper server is not running. Start it with: whisper-server -m ~/.recallmem/models/ggml-base.en.bin --port 8178",
        },
        502
      );
    }
    return json({ error: message }, 500);
  }
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
