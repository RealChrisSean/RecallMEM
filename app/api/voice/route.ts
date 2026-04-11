import { NextRequest } from "next/server";
import { spawn, ChildProcess } from "child_process";

export const runtime = "nodejs";

/**
 * Voice streaming endpoint using whisper-stream.
 *
 * GET /api/voice?action=start — starts whisper-stream, streams
 *   transcribed text back via SSE. whisper-stream reads directly
 *   from the system microphone (CoreAudio on Mac). The browser
 *   doesn't handle audio at all.
 *
 * POST /api/voice?action=stop — kills the whisper-stream process.
 *
 * Everything is 100% local. Audio goes from the mic to whisper-stream
 * to the browser. No network, no cloud, no third party.
 */

// Module-level reference so we can kill it from a different request.
let activeProcess: ChildProcess | null = null;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  const modelPath =
    process.env.WHISPER_MODEL ||
    `${process.env.HOME}/.recallmem/models/ggml-base.en.bin`;

  if (action === "start") {
    // Kill any existing process
    if (activeProcess) {
      activeProcess.kill("SIGTERM");
      activeProcess = null;
    }

    // Capture device ID (-1 = system default).
    // Set WHISPER_DEVICE env var or pass ?device=N in the URL.
    const deviceParam = url.searchParams.get("device");
    const captureDevice = deviceParam || process.env.WHISPER_DEVICE || "-1";

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      cancel() {
        // Client disconnected — kill the whisper-stream process
        if (activeProcess) {
          activeProcess.kill("SIGTERM");
          activeProcess = null;
        }
      },
      start(controller) {
        const proc = spawn("/opt/homebrew/bin/whisper-stream", [
          "-m", modelPath,
          "-c", captureDevice,  // capture device ID
          "--step", "2000",     // 2-second chunks for near-real-time
          "--length", "5000",   // 5-second context window
          "--keep", "500",      // overlap for continuity
          "--keep-context",     // maintain context between chunks
          "-t", "4",            // threads
          "--vad-thold", "0.5", // voice activity detection threshold
        ]);

        activeProcess = proc;

        // Send an initial SSE comment to flush headers immediately
        controller.enqueue(encoder.encode(": connected\n\n"));

        proc.stdout.on("data", (data: Buffer) => {
          const raw = data.toString();
          // Strip ANSI escape codes (cursor movement, clear line, etc.)
          // eslint-disable-next-line no-control-regex
          const text = raw.replace(/\x1b\[[0-9;]*[A-Za-z]|\r/g, "").trim();
          if (!text) return;

          const lines = text.split("\n");
          for (const line of lines) {
            const cleaned = line.trim();
            // Skip empty, whisper status lines, and blank audio markers
            if (
              !cleaned ||
              cleaned.startsWith("[") ||
              cleaned.includes("whisper_") ||
              cleaned.includes("BLANK_AUDIO")
            ) continue;

            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text: cleaned })}\n\n`)
            );
          }
        });

        proc.stderr.on("data", (data: Buffer) => {
          const text = data.toString();
          console.log("[whisper-stream stderr]", text.trim());
          // whisper-stream logs to stderr — only forward errors
          if (text.includes("error") || text.includes("Error")) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ error: text.trim() })}\n\n`
              )
            );
          }
        });

        proc.on("close", () => {
          activeProcess = null;
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`)
          );
          controller.close();
        });

        proc.on("error", (err) => {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: err.message })}\n\n`
            )
          );
          controller.close();
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  if (action === "devices") {
    // List available capture devices by spawning whisper-stream and reading stderr
    const devices: { id: number; name: string }[] = [];
    await new Promise<void>((resolve) => {
      let stderr = "";
      const proc = spawn("/opt/homebrew/bin/whisper-stream", [
        "-m", modelPath, "--length", "100",
      ]);

      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
        for (const line of stderr.split("\n")) {
          const match = line.match(/Capture device #(\d+): '(.+)'/);
          if (match) {
            const id = parseInt(match[1]);
            if (!devices.find((d) => d.id === id)) {
              devices.push({ id, name: match[2] });
            }
          }
        }
      });

      // Kill after 3s — we only need the device list from init output
      const timer = setTimeout(() => { proc.kill("SIGTERM"); resolve(); }, 3000);
      proc.on("close", () => { clearTimeout(timer); resolve(); });
    });

    return new Response(JSON.stringify({ devices }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "use ?action=start or ?action=devices" }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (action === "stop") {
    if (activeProcess) {
      activeProcess.kill("SIGTERM");
      activeProcess = null;
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true, status: "not running" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "use ?action=stop" }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}
