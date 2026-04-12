"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface VoiceAgentProps {
  onClose: () => void;
}

export default function VoiceAgent({ onClose }: VoiceAgentProps) {
  const [status, setStatus] = useState<"connecting" | "connected" | "speaking" | "listening" | "error">("connecting");
  const [transcript, setTranscript] = useState<{ role: string; text: string; id: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const playbackQueueRef = useRef<ArrayBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const currentAssistantTextRef = useRef("");
  const assistantTurnIdRef = useRef("");
  const assistantLockedRef = useRef(false);
  const turnCountRef = useRef(0);
  const connectingRef = useRef(false);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  // Timer
  useEffect(() => {
    if (status === "connected" || status === "speaking" || status === "listening") {
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [status]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  // Convert Float32 PCM to 16-bit PCM and base64 encode
  function float32ToBase64Pcm(float32: Float32Array): string {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    const bytes = new Uint8Array(int16.buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  // Decode base64 PCM audio and play it
  function queueAudio(base64: string) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    playbackQueueRef.current.push(bytes.buffer);
    if (!isPlayingRef.current) playNext();
  }

  function playNext() {
    const ctx = audioContextRef.current;
    if (!ctx || playbackQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      return;
    }
    isPlayingRef.current = true;

    const buffer = playbackQueueRef.current.shift()!;
    const int16 = new Int16Array(buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7FFF);
    }

    const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
    audioBuffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    source.onended = () => playNext();
    source.start();
  }

  const connect = useCallback(async () => {
    // Prevent duplicate connections (React StrictMode runs effects twice).
    // Don't check wsRef here — it may not be set yet if previous connect
    // is still awaiting fetch. connectingRef is never reset by cleanup.
    if (connectingRef.current) return;
    connectingRef.current = true;

    // If there's an existing connection from a previous mount, close it first
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      const configRes = await fetch("/api/voice-agent");
      if (!configRes.ok) {
        setError("No xAI provider configured. Add your xAI API key in Settings.");
        setStatus("error");
        return;
      }
      const config = await configRes.json() as { apiKey: string; systemPrompt: string };

      // Get mic
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // Create audio context at 24kHz for matching xAI's expected format
      const audioCtx = new AudioContext({ sampleRate: 24000 });
      audioContextRef.current = audioCtx;

      // Connect WebSocket to xAI
      const ws = new WebSocket("wss://api.x.ai/v1/realtime", [
        "realtime",
        `openai-insecure-api-key.${config.apiKey}`,
        "openai-beta.realtime-v1",
      ]);
      wsRef.current = ws;

      ws.onopen = () => {
        // Configure session with memory search tool
        ws.send(JSON.stringify({
          type: "session.update",
          session: {
            modalities: ["text", "audio"],
            instructions: config.systemPrompt + `

You have two tools that are ALWAYS active:

1. search_memory — Search the user's personal memory database. ALWAYS call this on EVERY exchange. The user chose RecallMEM because it remembers them. Use the user's message as the search query to find relevant facts, past conversations, and context. This is your primary source of knowledge about the user.

2. web_search — Search the internet for current information. Use this when the user asks about news, current events, companies, people, or anything that requires up-to-date information beyond what's in memory.

You can call both tools in the same turn if needed.`,
            voice: "eve",
            input_audio_format: "pcm16",
            output_audio_format: "pcm16",
            input_audio_transcription: { model: "whisper-1" },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 1000,
            },
            tools: [
              {
                type: "function",
                name: "search_memory",
                description: "Search the user's personal memory database for facts, past conversations, and context. Call this on EVERY user message to retrieve relevant memories.",
                parameters: {
                  type: "object",
                  properties: {
                    query: {
                      type: "string",
                      description: "Search query based on what the user is talking about.",
                    },
                  },
                  required: ["query"],
                },
              },
              { type: "web_search" },
              { type: "x_search" },
            ],
          },
        }));

        setStatus("listening");

        // Start streaming mic audio
        const source = audioCtx.createMediaStreamSource(stream);
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const inputData = e.inputBuffer.getChannelData(0);

          // Resample from audioCtx.sampleRate to 24000 if needed
          let pcmData: Float32Array;
          if (audioCtx.sampleRate !== 24000) {
            const ratio = audioCtx.sampleRate / 24000;
            const newLength = Math.round(inputData.length / ratio);
            pcmData = new Float32Array(newLength);
            for (let i = 0; i < newLength; i++) {
              pcmData[i] = inputData[Math.round(i * ratio)];
            }
          } else {
            pcmData = inputData;
          }

          ws.send(JSON.stringify({
            type: "input_audio_buffer.append",
            audio: float32ToBase64Pcm(pcmData),
          }));
        };

        source.connect(processor);
        processor.connect(audioCtx.destination);
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string) as Record<string, unknown>;
        const type = msg.type as string;

        // Log all messages for debugging
        if (!type.includes("audio.delta") && !type.includes("input_audio_buffer")) {
          console.log("[voice-agent]", type, msg);
        }

        switch (type) {
          // xAI uses "response.output_audio.delta" (not "response.audio.delta")
          case "response.output_audio.delta":
          case "response.audio.delta":
            if (msg.delta) {
              setStatus("speaking");
              queueAudio(msg.delta as string);
            }
            break;

          case "response.output_audio_transcript.delta": {
            if (msg.delta && !assistantLockedRef.current) {
              currentAssistantTextRef.current += msg.delta as string;
              const text = currentAssistantTextRef.current;
              const turnId = assistantTurnIdRef.current;
              setTranscript((prev) => {
                const lastIdx = prev.findLastIndex((t) => t.role === "assistant" && t.id === turnId);
                if (lastIdx >= 0) {
                  const updated = [...prev];
                  updated[lastIdx] = { role: "assistant", text, id: turnId };
                  return updated;
                }
                return [...prev, { role: "assistant", text, id: turnId }];
              });
            }
            break;
          }

          case "response.created": {
            currentAssistantTextRef.current = "";
            assistantTurnIdRef.current = `turn-${Date.now()}`;
            assistantLockedRef.current = false;
            break;
          }

          case "response.output_audio_transcript.done": {
            // Self-healing: replace bubble text with the clean final transcript.
            // This fixes any duplication from duplicate events or double connections.
            assistantLockedRef.current = true;
            const finalText = msg.transcript as string;
            if (finalText) {
              const turnId = assistantTurnIdRef.current;
              currentAssistantTextRef.current = finalText;
              setTranscript((prev) => {
                const lastIdx = prev.findLastIndex((t) => t.role === "assistant" && t.id === turnId);
                if (lastIdx >= 0) {
                  const updated = [...prev];
                  updated[lastIdx] = { role: "assistant", text: finalText, id: turnId };
                  return updated;
                }
                return prev;
              });
            }
            break;
          }

          // Ignore ALL other transcript events
          case "response.audio_transcript.delta":
          case "response.audio_transcript.done":
          case "response.text.delta":
          case "response.text.done":
          case "response.content_part.done":
            break;

          case "conversation.item.input_audio_transcription.completed": {
            const transcriptText = msg.transcript as string;
            if (transcriptText?.trim()) {
              const turnId = `user-${turnCountRef.current++}`;
              setTranscript((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "user" && last.text === transcriptText.trim()) return prev;
                return [...prev, { role: "user", text: transcriptText.trim(), id: turnId }];
              });
            }
            break;
          }

          case "response.done":
            setStatus("listening");
            break;

          // Function calling — Grok wants to search memory
          case "response.function_call_arguments.done": {
            const fnName = msg.name as string;
            const callId = msg.call_id as string;
            const args = JSON.parse((msg.arguments as string) || "{}");
            console.log("[voice-agent] function call:", fnName, args);

            if (fnName === "search_memory" && args.query) {
              // Hit our memory search API
              fetch("/api/voice-agent/memory", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: args.query }),
              })
                .then((r) => r.json())
                .then((results: { facts: string[]; conversations: string[] }) => {
                  const output = [
                    results.facts.length > 0 ? `Relevant facts:\n${results.facts.join("\n")}` : "No relevant facts found.",
                    results.conversations.length > 0 ? `\nFrom past conversations:\n${results.conversations.join("\n\n")}` : "",
                  ].join("\n");

                  // Send function result back to Grok
                  ws.send(JSON.stringify({
                    type: "conversation.item.create",
                    item: {
                      type: "function_call_output",
                      call_id: callId,
                      output,
                    },
                  }));
                  // Trigger Grok to respond with the new context
                  ws.send(JSON.stringify({ type: "response.create" }));
                })
                .catch((err) => {
                  console.error("[voice-agent] memory search failed:", err);
                  ws.send(JSON.stringify({
                    type: "conversation.item.create",
                    item: {
                      type: "function_call_output",
                      call_id: callId,
                      output: "Memory search failed. Answer based on what you already know.",
                    },
                  }));
                  ws.send(JSON.stringify({ type: "response.create" }));
                });
            }
            break;
          }

          case "ping":
            // Respond to keep-alive pings
            ws.send(JSON.stringify({ type: "pong" }));
            break;

          case "error": {
            const errObj = msg.error as Record<string, unknown> | undefined;
            console.error("[voice-agent] error:", msg);
            setError((errObj?.message as string) || "Voice agent error");
            break;
          }

          case "session.created":
          case "session.updated":
          case "conversation.created":
            console.log("[voice-agent] session ready");
            break;

          default:
            // Log unhandled events for debugging
            if (!type.includes("audio") && !type.includes("input_audio")) {
              console.log("[voice-agent] unhandled:", type);
            }
            break;
        }
      };

      ws.onerror = (e) => {
        console.error("[voice-agent] ws error:", e);
        setError("WebSocket connection failed");
        setStatus("error");
      };

      ws.onclose = (e) => {
        console.log("[voice-agent] ws closed:", e.code, e.reason);
        if (status !== "error") setStatus("connecting");
        cleanup();
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
      setStatus("error");
    }
  }, []);

  function cleanup() {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    playbackQueueRef.current = [];
    isPlayingRef.current = false;
    // Don't reset connectingRef — it prevents StrictMode double-connect
  }

  useEffect(() => {
    connect();
    return () => cleanup();
  }, [connect]);

  function handleClose() {
    cleanup();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight: "80vh" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${
              status === "listening" ? "bg-green-500 animate-pulse" :
              status === "speaking" ? "bg-blue-500 animate-pulse" :
              status === "error" ? "bg-red-500" :
              "bg-amber-500 animate-pulse"
            }`} />
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {status === "listening" ? "Listening..." :
               status === "speaking" ? "Speaking..." :
               status === "error" ? "Error" :
               "Connecting..."}
            </span>
            <span className="text-xs text-zinc-400">{formatTime(elapsed)}</span>
          </div>
          <button
            onClick={handleClose}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Transcript */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3 min-h-[200px]">
          {error && (
            <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 rounded-lg p-3">
              {error}
            </div>
          )}
          {transcript.length === 0 && !error && (
            <div className="text-sm text-zinc-400 text-center py-8">
              Start speaking — the AI will respond in real time
            </div>
          )}
          {transcript.map((t, i) => (
            <div key={t.id || i} className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                t.role === "user"
                  ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
              }`}>
                {t.text}
              </div>
            </div>
          ))}
          <div ref={transcriptEndRef} />
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="text-xs text-zinc-400">
            Powered by Grok Voice Agent · $0.05/min
          </div>
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            End Call
          </button>
        </div>
      </div>
    </div>
  );
}
