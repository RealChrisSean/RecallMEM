"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Message } from "@/lib/types";

type VoiceStatus =
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

interface VoiceAgentProps {
  chatId: string | null;
  messages: Message[];
  privateMode: boolean;
  onSaved: (chatId: string, messages: Message[]) => void;
  onClose: () => void;
}

interface VoiceAgentConfig {
  endpoint: string;
  token: string;
  authProtocol?: "bearer" | "token";
  settings: Record<string, unknown>;
}

interface TranscriptItem {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
}

interface DeepgramFunctionCall {
  id: string;
  name: string;
  arguments?: string;
  client_side?: boolean;
}

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

export default function VoiceAgent({
  chatId,
  messages,
  privateMode,
  onSaved,
  onClose,
}: VoiceAgentProps) {
  const [status, setStatus] = useState<VoiceStatus>("connecting");
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [micMuted, setMicMuted] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const captureContextRef = useRef<AudioContext | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const silenceGainRef = useRef<GainNode | null>(null);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const playbackTimeRef = useRef(0);
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const connectingRef = useRef(false);
  const streamingAudioRef = useRef(false);
  const chatIdRef = useRef(chatId);
  const messagesRef = useRef<Message[]>(messages);
  const lastSavedLengthRef = useRef(messages.length);
  const lastConversationTextRef = useRef("");
  const itemCounterRef = useRef(0);
  const micMutedRef = useRef(false);

  useEffect(() => {
    chatIdRef.current = chatId;
  }, [chatId]);

  useEffect(() => {
    messagesRef.current = messages;
    lastSavedLengthRef.current = messages.length;
  }, [messages]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  useEffect(() => {
    micMutedRef.current = micMuted;
    mediaStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !micMuted;
    });
  }, [micMuted]);

  useEffect(() => {
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  function nextId(role: string) {
    itemCounterRef.current += 1;
    return `${role}-${Date.now()}-${itemCounterRef.current}`;
  }

  function float32ToPcm16(float32: Float32Array): ArrayBuffer {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const sample = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return int16.buffer;
  }

  function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
    if (fromRate === toRate) return input;
    const ratio = fromRate / toRate;
    const outputLength = Math.max(1, Math.round(input.length / ratio));
    const output = new Float32Array(outputLength);
    for (let i = 0; i < outputLength; i++) {
      output[i] = input[Math.min(input.length - 1, Math.round(i * ratio))];
    }
    return output;
  }

  function stopPlayback() {
    activeSourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    });
    activeSourcesRef.current = [];
    playbackTimeRef.current = 0;
  }

  function playPcm16(arrayBuffer: ArrayBuffer) {
    if (arrayBuffer.byteLength === 0) return;
    const ctx =
      playbackContextRef.current ||
      new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    playbackContextRef.current = ctx;

    const int16 = new Int16Array(arrayBuffer.slice(0));
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
    }

    const audioBuffer = ctx.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
    audioBuffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    source.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== source);
    };

    const startAt = Math.max(ctx.currentTime + 0.02, playbackTimeRef.current || 0);
    playbackTimeRef.current = startAt + audioBuffer.duration;
    activeSourcesRef.current.push(source);
    source.start(startAt);
    setStatus("speaking");
  }

  async function saveMessages(nextMessages: Message[]) {
    if (nextMessages.length === 0 || nextMessages.length === lastSavedLengthRef.current) {
      return;
    }

    const res = await fetch("/api/voice-agent/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId: chatIdRef.current,
        messages: nextMessages,
      }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || `Save failed: ${res.status}`);
    }

    const data = (await res.json()) as { chatId: string };
    lastSavedLengthRef.current = nextMessages.length;
    chatIdRef.current = data.chatId;
    onSaved(data.chatId, nextMessages);
  }

  function appendConversationText(role: "user" | "assistant", text: string) {
    const cleaned = text.trim();
    if (!cleaned) return;

    const duplicateKey = `${role}:${cleaned}`;
    if (lastConversationTextRef.current === duplicateKey) return;
    lastConversationTextRef.current = duplicateKey;

    setTranscript((prev) => [
      ...prev,
      { id: nextId(role), role, text: cleaned },
    ]);

    const nextMessages = [
      ...messagesRef.current,
      { role, content: cleaned } satisfies Message,
    ];
    messagesRef.current = nextMessages;

    if (role === "assistant") {
      saveMessages(nextMessages).catch((err) => {
        console.error("[voice-agent] save failed:", err);
        setError(err instanceof Error ? err.message : "Voice transcript save failed");
      });
    }
  }

  async function handleFunctionCalls(calls: DeepgramFunctionCall[]) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    await Promise.all(
      calls
        .filter((fn) => fn.client_side !== false)
        .map(async (fn) => {
          let args: { query?: string } = {};
          try {
            args = JSON.parse(fn.arguments || "{}") as { query?: string };
          } catch {
            args = {};
          }

          let content = "Memory search failed. Answer based on the current conversation.";
          if (fn.name === "search_memory" && args.query?.trim()) {
            try {
              const res = await fetch("/api/voice-agent/memory", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  query: args.query,
                  chatId: chatIdRef.current,
                }),
              });
              const result = (await res.json()) as {
                facts?: string[];
                conversations?: string[];
              };
              content = JSON.stringify({
                facts: result.facts || [],
                conversations: result.conversations || [],
              });
            } catch (err) {
              console.error("[voice-agent] memory search failed:", err);
            }
          }

          ws.send(
            JSON.stringify({
              type: "FunctionCallResponse",
              id: fn.id,
              name: fn.name,
              content,
            })
          );
        })
    );
  }

  function startAudioStreaming(stream: MediaStream) {
    const ws = wsRef.current;
    if (!ws || streamingAudioRef.current) return;
    streamingAudioRef.current = true;

    const audioCtx = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
    captureContextRef.current = audioCtx;
    const source = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    const silenceGain = audioCtx.createGain();
    silenceGain.gain.value = 0;

    processorRef.current = processor;
    silenceGainRef.current = silenceGain;

    processor.onaudioprocess = (event) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (micMutedRef.current) return;
      const input = event.inputBuffer.getChannelData(0);
      const pcm = float32ToPcm16(
        resample(input, audioCtx.sampleRate, INPUT_SAMPLE_RATE)
      );
      ws.send(pcm);
    };

    source.connect(processor);
    processor.connect(silenceGain);
    silenceGain.connect(audioCtx.destination);
  }

  const connect = useCallback(async () => {
    if (connectingRef.current) return;
    connectingRef.current = true;

    try {
      setStatus("connecting");
      setError(null);

      const configRes = await fetch("/api/voice-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: chatIdRef.current,
          messages: messagesRef.current,
          privateMode,
        }),
      });

      const rawConfig = (await configRes.json().catch(() => ({}))) as
        Partial<VoiceAgentConfig> & { error?: string };

      if (!configRes.ok || !rawConfig.endpoint || !rawConfig.token || !rawConfig.settings) {
        throw new Error(rawConfig.error || "Could not start Deepgram Voice Agent");
      }

      const config: VoiceAgentConfig = {
        endpoint: rawConfig.endpoint,
        token: rawConfig.token,
        authProtocol: rawConfig.authProtocol === "token" ? "token" : "bearer",
        settings: rawConfig.settings,
      };

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: INPUT_SAMPLE_RATE,
        },
      });
      mediaStreamRef.current = stream;
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !micMutedRef.current;
      });

      const ws = new WebSocket(config.endpoint, [
        config.authProtocol || "bearer",
        config.token,
      ]);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify(config.settings));
        keepAliveRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "KeepAlive" }));
          }
        }, 10000);
      };

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          playPcm16(event.data);
          return;
        }

        if (event.data instanceof Blob) {
          event.data.arrayBuffer().then(playPcm16).catch(() => {});
          return;
        }

        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(event.data as string) as Record<string, unknown>;
        } catch {
          return;
        }

        const type = msg.type as string | undefined;
        if (!type) return;

        switch (type) {
          case "Welcome":
            break;

          case "SettingsApplied":
            setStatus("listening");
            startAudioStreaming(stream);
            break;

          case "UserStartedSpeaking":
            stopPlayback();
            setStatus("listening");
            break;

          case "AgentThinking":
            setStatus("thinking");
            break;

          case "ConversationText": {
            const role = msg.role as "user" | "assistant" | undefined;
            const content = msg.content as string | undefined;
            if (role === "user" || role === "assistant") {
              appendConversationText(role, content || "");
              setStatus(role === "user" ? "thinking" : "speaking");
            }
            break;
          }

          case "FunctionCallRequest": {
            const functions = (msg.functions || []) as DeepgramFunctionCall[];
            handleFunctionCalls(functions).catch((err) => {
              console.error("[voice-agent] function handling failed:", err);
            });
            break;
          }

          case "AgentAudioDone":
            setStatus("listening");
            break;

          case "Warning":
            console.warn("[voice-agent] warning:", msg);
            break;

          case "Error":
            console.error("[voice-agent] error:", msg);
            setError(
              (msg.description as string | undefined) ||
                (msg.message as string | undefined) ||
                "Deepgram Voice Agent error"
            );
            setStatus("error");
            break;

          default:
            if (!type.toLowerCase().includes("audio")) {
              console.log("[voice-agent] unhandled:", type, msg);
            }
        }
      };

      ws.onerror = (event) => {
        console.error("[voice-agent] websocket error:", event);
        setError("Deepgram Voice Agent connection failed");
        setStatus("error");
      };

      ws.onclose = () => {
        if (status !== "error") setStatus("connecting");
        cleanup();
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start Voice Agent");
      setStatus("error");
      cleanup();
    }
  // Connect once for the life of the modal. Helper functions read/write refs
  // intentionally so reconnects do not happen on transcript state updates.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [privateMode]);

  function cleanup() {
    if (keepAliveRef.current) {
      clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (silenceGainRef.current) {
      silenceGainRef.current.disconnect();
      silenceGainRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (captureContextRef.current) {
      captureContextRef.current.close().catch(() => {});
      captureContextRef.current = null;
    }
    stopPlayback();
    if (playbackContextRef.current) {
      playbackContextRef.current.close().catch(() => {});
      playbackContextRef.current = null;
    }
    if (wsRef.current) {
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }
    streamingAudioRef.current = false;
  }

  useEffect(() => {
    connect();
    return () => cleanup();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connect]);

  async function handleClose() {
    try {
      await saveMessages(messagesRef.current);
    } catch {
      // The modal can still close; the user transcript is visible locally.
    }
    cleanup();
    onClose();
  }

  const statusLabel =
    micMuted && status !== "connecting" && status !== "error"
      ? status === "speaking"
        ? "Speaking · mic muted"
        : "Mic muted"
      : status === "listening"
      ? "Listening"
      : status === "thinking"
        ? "Thinking"
        : status === "speaking"
          ? "Speaking"
          : status === "error"
            ? "Needs attention"
            : "Connecting";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-4">
      <div className="flex h-[min(44rem,92dvh)] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={`h-3 w-3 rounded-full ${
                status === "listening"
                  ? "bg-emerald-500"
                  : status === "thinking"
                    ? "bg-amber-500"
                    : status === "speaking"
                      ? "bg-blue-500"
                      : status === "error"
                        ? "bg-red-500"
                        : "bg-zinc-400"
              } ${status !== "error" ? "animate-pulse" : ""}`}
            />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Deepgram Voice Agent
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                {statusLabel} · {formatTime(elapsed)} · GPT-5.5
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMicMuted((muted) => !muted)}
              aria-pressed={micMuted}
              className={`rounded-full p-2 transition-colors ${
                micMuted
                  ? "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900"
                  : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
              }`}
              aria-label={micMuted ? "Unmute microphone" : "Mute microphone"}
              title={micMuted ? "Unmute microphone" : "Mute microphone"}
            >
              {micMuted ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2a3 3 0 0 0-3 3v5" />
                  <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
                  <path d="M19 10v2a7 7 0 0 1-.74 3.13" />
                  <path d="M5 10v2a7 7 0 0 0 11.9 5" />
                  <path d="M12 19v3" />
                  <path d="M8 22h8" />
                  <path d="m2 2 20 20" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <path d="M12 19v3" />
                  <path d="M8 22h8" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="rounded-full p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
              aria-label="Close voice agent"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="relative flex flex-1 flex-col overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),transparent_36%),radial-gradient(circle_at_bottom,_rgba(16,185,129,0.12),transparent_30%)]">
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-8 text-center">
            <div
              className={`mb-5 flex h-28 w-28 items-center justify-center rounded-full border ${
                status === "speaking"
                  ? "border-blue-300 bg-blue-500/10"
                  : status === "thinking"
                    ? "border-amber-300 bg-amber-500/10"
                    : "border-emerald-300 bg-emerald-500/10"
              } shadow-[0_0_80px_rgba(59,130,246,0.25)]`}
            >
              <div
                className={`h-16 w-16 rounded-full ${
                  status === "speaking"
                    ? "bg-blue-500"
                    : status === "thinking"
                      ? "bg-amber-500"
                      : status === "error"
                        ? "bg-red-500"
                        : "bg-emerald-500"
                } ${status !== "error" ? "animate-pulse" : ""}`}
              />
            </div>
            <p className="max-w-xs text-sm text-zinc-600 dark:text-zinc-300">
              {micMuted
                ? "Your mic is muted. The AI can keep talking, and you can unmute when you want to jump back in."
                : "Talk naturally. I can use RecallMEM memory through tools, and I'll save the voice turn back into this chat."}
            </p>
            {privateMode && (
              <p className="mt-3 max-w-xs rounded-full bg-amber-100 px-3 py-1 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                Private mode is on: stored memory is not sent to the voice model.
              </p>
            )}
          </div>

          <div className="max-h-56 overflow-y-auto border-t border-zinc-200 bg-white/75 p-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/75">
            {error && (
              <div className="mb-3 rounded-2xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
                {error}
              </div>
            )}
            {transcript.length === 0 && !error && (
              <div className="py-4 text-center text-sm text-zinc-400">
                The live transcript will appear here.
              </div>
            )}
            <div className="space-y-2">
              {transcript.map((item) => (
                <div
                  key={item.id}
                  className={`flex ${item.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[82%] rounded-2xl px-3 py-2 text-sm ${
                      item.role === "user"
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
                    }`}
                  >
                    {item.text}
                  </div>
                </div>
              ))}
              <div ref={transcriptEndRef} />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800 sm:px-5">
          <div className="min-w-0 text-xs text-zinc-500 dark:text-zinc-400">
            Nova-3 · Aura-2 Amalthea · Deepgram
            {micMuted && <span className="ml-2 text-amber-600 dark:text-amber-300">Mic muted</span>}
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
          >
            End call
          </button>
        </div>
      </div>
    </div>
  );
}
