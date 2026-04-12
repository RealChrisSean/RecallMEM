"use client";

import { useState, useRef, useEffect, useCallback, memo, FormEvent, DragEvent, ChangeEvent } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ModelMode, Message, AttachedFile } from "@/lib/types";
import { MODEL_OPTIONS, type ModelId } from "@/lib/llm-config";
import { AppFooter } from "@/components/AppFooter";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import dynamic from "next/dynamic";
const VoiceAgent = dynamic(() => import("@/components/VoiceAgent"), { ssr: false });

const MODEL_STORAGE_KEY = "recallmem_selected_model";
const SIDEBAR_STORAGE_KEY = "recallmem_sidebar_open";
const DEFAULT_MODEL: ModelId = "gemma4:26b";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

interface ChatListItem {
  id: string;
  title: string | null;
  message_count: number;
  model_mode: ModelMode;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
}

interface ProviderListItem {
  id: string;
  label: string;
  type: "ollama" | "anthropic" | "openai" | "openai-compatible";
  model: string;
}

// Encoded model selection: either "ollama:gemma4:26b" (built-in) or "provider:<id>"
type Selection =
  | { kind: "ollama"; modelId: ModelId }
  | { kind: "provider"; providerId: string };

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [mode, setMode] = useState<ModelMode>("standard");
  const [chatId, setChatId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<ModelId>(DEFAULT_MODEL);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [selectedProviderModel, setSelectedProviderModel] = useState<string | null>(null);
  const [customProviders, setCustomProviders] = useState<ProviderListItem[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  // Parallel array holding the raw File objects for pending text/PDF uploads.
  // Images don't need this because their content is already a data URL on attach.
  const [pendingRawFiles, setPendingRawFiles] = useState<(File | null)[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [webSearch, setWebSearch] = useState(false);
  const [showWebSearchWarning, setShowWebSearchWarning] = useState(false);
  const [dontShowWebSearchWarning, setDontShowWebSearchWarning] = useState(false);
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [privateMode, setPrivateMode] = useState(false);
  const [showBrainPicker, setShowBrainPicker] = useState(true);

  // Sync brain picker visibility from localStorage on mount.
  // Uses a layout-blocking approach: inject a style tag immediately
  // to hide the picker before React even paints.
  useEffect(() => {
    if (localStorage.getItem("recallmem.showBrainPicker") === "false") {
      setShowBrainPicker(false);
    }
  }, []);

  const [showBrainHint, setShowBrainHint] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [showVoiceAgent, setShowVoiceAgent] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingLoopRef = useRef<boolean>(false);
  const silenceCountRef = useRef(0);
  const [idlePrompt, setIdlePrompt] = useState(false);
  const [idleCountdown, setIdleCountdown] = useState(30);
  const idleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const SILENCE_CHUNKS_BEFORE_PROMPT = 20; // ~60s of silence (20 x 3s chunks)
  const IDLE_COUNTDOWN_SECONDS = 30;

  function startIdleCountdown() {
    setIdlePrompt(true);
    setIdleCountdown(IDLE_COUNTDOWN_SECONDS);
    idleTimerRef.current = setInterval(() => {
      setIdleCountdown((prev) => {
        if (prev <= 1) {
          // Time's up -- stop recording
          stopRecording();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  function dismissIdlePrompt() {
    setIdlePrompt(false);
    silenceCountRef.current = 0;
    if (idleTimerRef.current) {
      clearInterval(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      setIsRecording(true);
      recordingLoopRef.current = true;
      silenceCountRef.current = 0;

      while (recordingLoopRef.current) {
        const text = await recordChunkAndTranscribe(stream);
        if (text && recordingLoopRef.current) {
          setInput((prev) => (prev ? prev + " " + text : text));
          silenceCountRef.current = 0;
          // If idle prompt is showing and user spoke, dismiss it
          if (idlePrompt) dismissIdlePrompt();
        } else if (recordingLoopRef.current && !idlePrompt) {
          silenceCountRef.current++;
          if (silenceCountRef.current >= SILENCE_CHUNKS_BEFORE_PROMPT) {
            startIdleCountdown();
          }
        }
      }
    } catch (err) {
      console.error("[voice] mic access error:", err);
    } finally {
      setIsRecording(false);
      dismissIdlePrompt();
    }
  }

  function recordChunkAndTranscribe(stream: MediaStream): Promise<string> {
    return new Promise((resolve) => {
      if (!recordingLoopRef.current) { resolve(""); return; }

      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      mediaRecorderRef.current = recorder;
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      recorder.onstop = async () => {
        if (!chunks.length) { resolve(""); return; }
        const blob = new Blob(chunks, { type: "audio/webm" });
        try {
          const form = new FormData();
          form.append("audio", blob, "chunk.webm");
          const res = await fetch("/api/transcribe", { method: "POST", body: form });
          const data = await res.json() as { text?: string };
          const text = (data.text || "").trim();
          if (text && !text.startsWith("[") && !text.includes("BLANK") && text.length > 1) {
            resolve(text);
          } else {
            resolve("");
          }
        } catch {
          resolve("");
        }
      };

      recorder.start();
      setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 3000);
    });
  }

  function stopRecording() {
    recordingLoopRef.current = false;
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (recordingStreamRef.current) {
      recordingStreamRef.current.getTracks().forEach((t) => t.stop());
      recordingStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
    setIsRecording(false);
    dismissIdlePrompt();
  }

  // TTS: chunked playback — splits long text into ~500 char pieces,
  // fetches the first chunk immediately so audio starts fast, then
  // pre-fetches remaining chunks in the background and plays them
  // back-to-back seamlessly.
  const activeSpeechRef = useRef<HTMLAudioElement | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsLoading, setTtsLoading] = useState(false);
  const ttsAbortRef = useRef(false);

  function stopSpeaking() {
    ttsAbortRef.current = true;
    if (activeSpeechRef.current) {
      activeSpeechRef.current.pause();
      activeSpeechRef.current.currentTime = 0;
      activeSpeechRef.current = null;
    }
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setTtsLoading(false);
  }

  // Split text into chunks at sentence boundaries, ~500 chars each
  function splitTtsChunks(text: string, maxLen = 500): string[] {
    const sentences = text.split(/(?<=[.!?])\s+/);
    const chunks: string[] = [];
    let buf = "";
    for (const s of sentences) {
      if (buf.length + s.length + 1 > maxLen && buf) {
        chunks.push(buf.trim());
        buf = s;
      } else {
        buf = buf ? buf + " " + s : s;
      }
    }
    if (buf.trim()) chunks.push(buf.trim());
    return chunks.length > 0 ? chunks : [text];
  }

  async function fetchTtsAudio(text: string): Promise<Blob | null> {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok && res.headers.get("Content-Type")?.includes("audio")) {
        return res.blob();
      }
    } catch { /* fall through */ }
    return null;
  }

  function getAudioEl(): HTMLAudioElement {
    let el = document.getElementById("recallmem-tts-audio") as HTMLAudioElement | null;
    if (!el) {
      el = document.createElement("audio");
      el.id = "recallmem-tts-audio";
      document.body.appendChild(el);
    }
    return el;
  }

  async function speakText(text: string) {
    // If already speaking or loading, stop instead
    if (isSpeaking || ttsLoading) { stopSpeaking(); return; }

    ttsAbortRef.current = false;
    setTtsLoading(true);

    const chunks = splitTtsChunks(text);

    // Fetch first chunk immediately
    const firstBlob = await fetchTtsAudio(chunks[0]);

    if (!firstBlob || ttsAbortRef.current) {
      // No cloud TTS — fallback to browser
      setTtsLoading(false);
      setIsSpeaking(true);
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.1;
      utterance.onend = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
      return;
    }

    setTtsLoading(false);
    setIsSpeaking(true);

    // Pre-fetch remaining chunks in background
    const blobPromises = chunks.slice(1).map((c) => fetchTtsAudio(c));

    // Play chunks sequentially
    const allBlobs: (Blob | null)[] = [firstBlob];
    for (const p of blobPromises) {
      allBlobs.push(await p);
    }

    for (const blob of allBlobs) {
      if (ttsAbortRef.current || !blob) break;

      const url = URL.createObjectURL(blob);
      const audioEl = getAudioEl();
      audioEl.src = url;
      activeSpeechRef.current = audioEl;

      try {
        await new Promise<void>((resolve, reject) => {
          audioEl.onended = () => { URL.revokeObjectURL(url); resolve(); };
          audioEl.onerror = () => { URL.revokeObjectURL(url); reject(); };
          audioEl.play().catch(reject);
        });
      } catch {
        URL.revokeObjectURL(url);
        break;
      }
    }

    activeSpeechRef.current = null;
    if (!ttsAbortRef.current) setIsSpeaking(false);
  }

  // Stop TTS on page unload / refresh
  useEffect(() => {
    const cleanup = () => stopSpeaking();
    window.addEventListener("beforeunload", cleanup);
    return () => { cleanup(); window.removeEventListener("beforeunload", cleanup); };
  }, []);

  // Cmd+Shift+H (Mac) / Ctrl+Shift+H (Windows) toggles brain picker visibility
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setShowBrainPicker((v) => {
          const next = !v;
          localStorage.setItem("recallmem.showBrainPicker", next ? "true" : "false");
          // Update the CSS class so it takes effect immediately
          if (next) {
            document.documentElement.classList.remove("hide-brain-picker");
          } else {
            document.documentElement.classList.add("hide-brain-picker");
            const muted = localStorage.getItem("recallmem.brainHintMuted");
            if (!muted || Date.now() > Number(muted)) {
              setShowBrainHint(true);
            }
          }
          return next;
        });
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);
  const [activeBrain, setActiveBrain] = useState("default");
  const [brains, setBrains] = useState<{ name: string; emoji: string }[]>([
    { name: "default", emoji: "🧠" },
  ]);

  // Load brains from the database on mount. One-time migration from localStorage.
  useEffect(() => {
    fetch("/api/brains")
      .then((r) => r.json())
      .then(async (d: { brains: { name: string; emoji: string }[] }) => {
        const dbBrains = d.brains || [];

        // One-time migration: if brains exist in localStorage but not in DB, push them
        const lsBrains = localStorage.getItem("recallmem.brains");
        if (lsBrains && dbBrains.length === 0) {
          try {
            const parsed = JSON.parse(lsBrains) as { name: string; emoji: string }[] | string[];
            const toMigrate = (Array.isArray(parsed) ? parsed : []).filter(
              (b) => (typeof b === "string" ? b : b.name) !== "default"
            );
            for (const b of toMigrate) {
              const name = typeof b === "string" ? b : b.name;
              const emoji = typeof b === "string" ? "⭐" : b.emoji;
              await fetch("/api/brains", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, emoji }),
              });
              dbBrains.push({ name, emoji });
            }
            // Clear localStorage after migration
            localStorage.removeItem("recallmem.brains");
          } catch { /* ignore */ }
        }

        const all = [{ name: "default", emoji: "🧠" }, ...dbBrains.filter((b) => b.name !== "default")];
        setBrains(all);
      })
      .catch(() => {});

    const savedBrain = localStorage.getItem("recallmem.activeBrain");
    if (savedBrain) setActiveBrain(savedBrain);
  }, []);

  // Set the brain cookie whenever activeBrain changes
  useEffect(() => {
    document.cookie = `recallmem-brain=${activeBrain};path=/;max-age=31536000`;
    localStorage.setItem("recallmem.activeBrain", activeBrain);
    refreshChatList();
  }, [activeBrain]);

  function addBrain(name: string) {
    const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").trim();
    if (!slug || brains.some((b) => b.name === slug)) return;

    const KEYWORD_EMOJIS: Record<string, string> = {
      work: "💼", job: "💼", career: "💼", office: "💼",
      personal: "🏠", home: "🏠", family: "🏠", life: "🏠",
      demo: "🎯", test: "🎯", showcase: "🎯",
      study: "📚", learn: "📚", school: "📚", education: "📚",
      code: "💻", dev: "💻", coding: "💻", programming: "💻",
      research: "🔬", science: "🔬", explore: "🔬",
      creative: "🎨", art: "🎨", design: "🎨", write: "🎨", writing: "✍️",
      health: "❤️", fitness: "💪", gym: "💪", medical: "❤️",
      finance: "💰", money: "💰", invest: "📈", budget: "💰",
      travel: "✈️", trip: "✈️", vacation: "🌴",
      music: "🎵", podcast: "🎙️", video: "🎬", content: "🎬",
      legal: "⚖️", law: "⚖️", lawyer: "⚖️",
      startup: "🚀", business: "🚀", project: "🚀",
      social: "💬", friends: "👥", dating: "💝",
      gaming: "🎮", game: "🎮",
      food: "🍕", cooking: "👨‍🍳", recipe: "🍕",
      spanish: "🇪🇸", french: "🇫🇷", japanese: "🇯🇵", language: "🗣️",
    };
    const FALLBACK_EMOJIS = [
      "⭐", "🌟", "💡", "🔮", "🎪", "🌈", "🦊", "🐝",
      "🍀", "🔥", "💎", "🎲", "🧩", "🌙", "☀️", "🏔️",
    ];

    const usedEmojis = new Set(brains.map((b) => b.emoji));
    let emoji = "";
    for (const [keyword, e] of Object.entries(KEYWORD_EMOJIS)) {
      if (slug.includes(keyword) && !usedEmojis.has(e)) { emoji = e; break; }
    }
    if (!emoji) emoji = FALLBACK_EMOJIS.find((e) => !usedEmojis.has(e)) || "🧠";

    // Save to database
    fetch("/api/brains", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: slug, emoji }),
    }).catch(() => {});

    setBrains((prev) => [...prev, { name: slug, emoji }]);
    setActiveBrain(slug);
  }

  async function switchBrain(slug: string) {
    // Finalize current conversation before switching (same as newChat/loadChat)
    if (chatId && messages.length >= 2) {
      try {
        await fetch("/api/chat/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId }),
        });
      } catch (err) {
        console.error("Finalize on brain switch failed:", err);
      }
    }
    setActiveBrain(slug);
    setMessages([]);
    setChatId(null);
  }

  function deleteBrain(slug: string) {
    if (slug === "default") return;
    if (!confirm(`Delete the "${slug}" brain? All its chats and memory will remain in the database but won't be accessible from the UI.`)) return;

    fetch("/api/brains", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: slug }),
    }).catch(() => {});

    setBrains((prev) => prev.filter((b) => b.name !== slug));
    if (activeBrain === slug) switchBrain("default");
  }

  function renameBrain(slug: string) {
    if (slug === "default") return;
    const newName = prompt(`Rename "${slug}" to:`, slug);
    if (!newName || newName === slug) return;
    const newSlug = newName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").trim();
    if (!newSlug || brains.some((b) => b.name === newSlug)) return;

    fetch("/api/brains", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldName: slug, newName: newSlug }),
    }).catch(() => {});

    setBrains((prev) =>
      prev.map((b) => (b.name === slug ? { ...b, name: newSlug } : b))
    );
    if (activeBrain === slug) setActiveBrain(newSlug);
  }
  // Installed Ollama models. Used to detect when the user picks one from
  // the dropdown that hasn't been pulled yet, so we can offer to download.
  const [installedOllamaModels, setInstalledOllamaModels] = useState<Set<string>>(
    new Set()
  );
  const [pendingDownloadModel, setPendingDownloadModel] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{
    status: string;
    completed?: number;
    total?: number;
  } | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // True when the user has no way to chat yet: no Gemma chat model
  // installed AND no cloud provider configured. Drives the empty-state
  // banner above the input and disables the message input until they
  // pick one or the other.
  //
  // IMPORTANT: only compute this AFTER the models + providers lists have
  // loaded. Before that, both are empty sets/arrays and we'd wrongly
  // disable the input on every page load until the async fetches finish.
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const hasGemmaInstalled = Array.from(installedOllamaModels).some((name) =>
    name.startsWith("gemma4")
  );
  const hasCloudProvider = customProviders.some((p) => p.type !== "ollama");
  const noChatBackend = modelsLoaded && !hasGemmaInstalled && !hasCloudProvider;
  const [chatList, setChatList] = useState<ChatListItem[]>([]);
  const chatIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load sidebar state
  useEffect(() => {
    const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (saved !== null) setSidebarOpen(saved === "true");
  }, []);
  useEffect(() => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarOpen));
  }, [sidebarOpen]);

  // Fetch chat list
  async function refreshChatList() {
    try {
      const res = await fetch("/api/chats");
      if (res.ok) {
        const data = (await res.json()) as ChatListItem[];
        setChatList(data);
      }
    } catch (err) {
      console.error("Failed to fetch chats:", err);
    }
  }

  // Poll the chat list waiting for a specific chat to get its title generated.
  // Used after sending a message because title generation is fire-and-forget on
  // the server and the frontend has no way to know exactly when it finishes.
  // Polls every 700ms for up to 15 seconds.
  async function pollForChatTitle(targetChatId: string) {
    const TIMEOUT_MS = 20000;
    const startedAt = Date.now();

    while (Date.now() - startedAt < TIMEOUT_MS) {
      // Poll fast: 300ms intervals for the first 5s, then 1s after
      const elapsed = Date.now() - startedAt;
      const interval = elapsed < 5000 ? 300 : 1000;
      await new Promise((r) => setTimeout(r, interval));

      try {
        const res = await fetch("/api/chats");
        if (!res.ok) continue;
        const data = (await res.json()) as ChatListItem[];
        setChatList(data);
        const target = data.find((c) => c.id === targetChatId);
        if (target?.title) return;
      } catch {
        // keep trying
      }
    }
  }

  // Load chat list on mount
  useEffect(() => {
    refreshChatList();
  }, []);

  // Refresh chat list when finalize completes (so new titles show up)
  useEffect(() => {
    if (!isFinalizing) {
      refreshChatList();
    }
  }, [isFinalizing]);

  // Load a chat into the main view
  async function loadChat(id: string) {
    if (isStreaming || isFinalizing) return;

    // Finalize the current chat first if there's one with content
    if (chatId && messages.length >= 2 && chatId !== id) {
      setIsFinalizing(true);
      try {
        await fetch("/api/chat/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId }),
        });
      } catch (err) {
        console.error("Finalize failed:", err);
      } finally {
        setIsFinalizing(false);
      }
    }

    try {
      const res = await fetch(`/api/chats/${id}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        id: string;
        messages: Message[];
      };
      setChatId(data.id);
      // Strip trailing empty assistant messages — these can be left over
      // from a periodic save during streaming if the user refreshed
      // mid-generation. Without this, reloading shows typing dots forever.
      let msgs = data.messages;
      while (
        msgs.length > 0 &&
        msgs[msgs.length - 1].role === "assistant" &&
        !msgs[msgs.length - 1].content?.trim()
      ) {
        msgs = msgs.slice(0, -1);
      }
      setMessages(msgs);
      setInput("");
      setAttachedFiles([]);
      setUploadError(null);
    } catch (err) {
      console.error("Failed to load chat:", err);
    }
  }

  // Toggle pinned state for a chat
  async function togglePin(id: string, currentlyPinned: boolean) {
    // Optimistic update
    setChatList((prev) =>
      prev.map((c) => (c.id === id ? { ...c, is_pinned: !currentlyPinned } : c))
    );
    try {
      await fetch(`/api/chats/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_pinned: !currentlyPinned }),
      });
      refreshChatList();
    } catch (err) {
      console.error("Failed to toggle pin:", err);
      refreshChatList(); // revert by reloading from server
    }
  }

  // Delete a chat
  async function deleteChat(id: string) {
    if (!confirm("Delete this conversation? This cannot be undone.")) return;
    try {
      await fetch(`/api/chats/${id}`, { method: "DELETE" });
      // If we just deleted the active chat, clear the view
      if (chatId === id) {
        setMessages([]);
        setChatId(null);
        setInput("");
      }
      refreshChatList();
    } catch (err) {
      console.error("Failed to delete chat:", err);
    }
  }

  // Load the saved model selection on mount.
  // Format: "ollama:<modelId>" or "provider:<providerId>::<modelId>"
  useEffect(() => {
    const saved = localStorage.getItem(MODEL_STORAGE_KEY);
    if (!saved) return;
    if (saved.startsWith("provider:")) {
      const rest = saved.slice("provider:".length);
      const sep = rest.indexOf("::");
      if (sep !== -1) {
        setSelectedProviderId(rest.slice(0, sep));
        setSelectedProviderModel(rest.slice(sep + 2));
      } else {
        setSelectedProviderId(rest);
      }
    } else if (saved.startsWith("ollama:")) {
      const id = saved.slice("ollama:".length);
      if (MODEL_OPTIONS.some((m) => m.id === id)) {
        setSelectedModel(id as ModelId);
      }
    } else if (MODEL_OPTIONS.some((m) => m.id === saved)) {
      setSelectedModel(saved as ModelId);
    }
  }, []);

  // Persist model selection
  useEffect(() => {
    if (selectedProviderId) {
      const model = selectedProviderModel ? `::${selectedProviderModel}` : "";
      localStorage.setItem(MODEL_STORAGE_KEY, `provider:${selectedProviderId}${model}`);
    } else {
      localStorage.setItem(MODEL_STORAGE_KEY, `ollama:${selectedModel}`);
    }
  }, [selectedModel, selectedProviderId, selectedProviderModel]);

  // Close modals on Escape key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPendingDownloadModel(null);
        setDownloadProgress(null);
        setDownloadError(null);
        setShowWebSearchWarning(false);
        setDontShowWebSearchWarning(false);
        setIsDragging(false);
        setShowBrainHint(false);
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, []);

  // Load + persist web search toggle
  useEffect(() => {
    const saved = localStorage.getItem("recallmem.webSearch");
    if (saved === "true") setWebSearch(true);
  }, []);
  useEffect(() => {
    localStorage.setItem("recallmem.webSearch", webSearch ? "true" : "false");
  }, [webSearch]);

  // Load the list of installed Ollama models so we know which dropdown
  // picks need a download.
  const refreshInstalledModels = useCallback(async () => {
    try {
      const res = await fetch("/api/models/list");
      if (!res.ok) return;
      const data = (await res.json()) as { ok: boolean; models?: { name: string }[] };
      if (data.ok && data.models) {
        // Ollama returns names like "gemma4:26b" and sometimes "gemma4:26b-latest".
        // Strip the trailing "-latest" if present so the comparison matches.
        const names = new Set<string>();
        for (const m of data.models) {
          names.add(m.name);
          if (m.name.endsWith(":latest")) {
            names.add(m.name.replace(/:latest$/, ""));
          }
        }
        setInstalledOllamaModels(names);
      }
      setModelsLoaded(true);
    } catch (err) {
      console.error("[models] list failed:", err);
      setModelsLoaded(true); // still mark loaded so we don't block the input forever
    }
  }, []);
  useEffect(() => {
    refreshInstalledModels();
  }, [refreshInstalledModels]);

  // When the user picks an Ollama model from the dropdown, check if it's
  // actually installed. If yes, just select it. If no, show the download
  // modal so they can pull it without leaving the chat.
  function handleOllamaSelect(id: ModelId) {
    if (installedOllamaModels.has(id)) {
      setSelectedModel(id);
      setSelectedProviderId(null);
    } else {
      setPendingDownloadModel(id);
      setDownloadProgress(null);
      setDownloadError(null);
    }
  }

  // Start a model download via the server-side pull endpoint and poll
  // for progress. The download runs server-side so it survives page
  // navigation (settings → chat or vice versa).
  async function startModelDownload(model: string) {
    setDownloadProgress({ status: "starting" });
    setDownloadError(null);
    try {
      const res = await fetch("/api/models/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      if (!res.ok) {
        setDownloadError(`Server returned ${res.status}`);
        return;
      }
      const poll = setInterval(async () => {
        try {
          const pRes = await fetch(`/api/models/pull?model=${encodeURIComponent(model)}`);
          if (!pRes.ok) return;
          const p = (await pRes.json()) as {
            status: string;
            completed?: number;
            total?: number;
            error?: string;
            done: boolean;
          };
          setDownloadProgress({
            status: p.status,
            completed: p.completed,
            total: p.total,
          });
          if (p.error) {
            setDownloadError(p.error);
            clearInterval(poll);
          }
          if (p.done && !p.error) {
            clearInterval(poll);
            await refreshInstalledModels();
            setSelectedModel(model as ModelId);
            setSelectedProviderId(null);
            setPendingDownloadModel(null);
            setDownloadProgress(null);
          }
        } catch {
          // poll failed, keep trying
        }
      }, 500);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : String(err));
    }
  }

  async function cancelModelDownload(model: string) {
    try {
      await fetch(`/api/models/pull?model=${encodeURIComponent(model)}`, {
        method: "DELETE",
      });
      setPendingDownloadModel(null);
      setDownloadProgress(null);
      setDownloadError(null);
    } catch {
      // ignore
    }
  }

  // Fetch custom providers
  async function refreshProviders() {
    try {
      const res = await fetch("/api/providers");
      if (res.ok) {
        const data = (await res.json()) as ProviderListItem[];
        setCustomProviders(data);
      }
    } catch (err) {
      console.error("Failed to load providers:", err);
    }
  }
  useEffect(() => {
    refreshProviders();
  }, []);

  // Keep ref in sync so the beforeunload handler can read the latest value
  useEffect(() => {
    chatIdRef.current = chatId;
  }, [chatId]);

  // Save draft input as you type — recover if window closes mid-typing
  useEffect(() => {
    if (input) {
      localStorage.setItem("recallmem.draftInput", input);
    } else {
      localStorage.removeItem("recallmem.draftInput");
    }
  }, [input]);

  // Restore draft input on mount
  useEffect(() => {
    const draft = localStorage.getItem("recallmem.draftInput");
    if (draft) setInput(draft);
  }, []);

  // SAFETY NET: backup messages to localStorage, throttled to every 5s.
  const lastBackupRef = useRef(0);
  useEffect(() => {
    if (chatId && messages.length >= 2) {
      const now = Date.now();
      if (now - lastBackupRef.current < 5000) return;
      lastBackupRef.current = now;
      try {
        localStorage.setItem("recallmem.chatBackup", JSON.stringify({
          chatId,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          savedAt: now,
        }));
      } catch { /* localStorage full or unavailable */ }
    }
  }, [chatId, messages]);

  // On mount: check for unsaved backup. If the DB has 0 messages for that
  // chat but we have messages in localStorage, re-save them to the server.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("recallmem.chatBackup");
      if (!raw) return;
      const backup = JSON.parse(raw) as { chatId: string; messages: { role: string; content: string }[]; savedAt: number };
      // Only recover if backup is less than 24 hours old
      if (Date.now() - backup.savedAt > 24 * 60 * 60 * 1000) {
        localStorage.removeItem("recallmem.chatBackup");
        return;
      }
      // Check if the chat in DB has messages
      fetch(`/api/chats/${backup.chatId}`)
        .then((r) => r.ok ? r.json() : null)
        .then((chat: { message_count?: number } | null) => {
          if (chat && chat.message_count === 0 && backup.messages.length >= 2) {
            console.warn("[recovery] Found unsaved chat backup, re-saving to server...");
            fetch("/api/chat/recover", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chatId: backup.chatId, messages: backup.messages }),
            }).then(() => {
              console.log("[recovery] Chat recovered successfully");
              localStorage.removeItem("recallmem.chatBackup");
              refreshChatList();
            }).catch(() => {});
          } else {
            // Chat already has messages, backup not needed
            localStorage.removeItem("recallmem.chatBackup");
          }
        })
        .catch(() => {});
    } catch { /* ignore */ }
  }, []);

  // On tab close: best-effort save of memory using sendBeacon (fire-and-forget)
  useEffect(() => {
    function handleBeforeUnload() {
      if (chatIdRef.current && messages.length >= 2) {
        const blob = new Blob(
          [JSON.stringify({ chatId: chatIdRef.current })],
          { type: "application/json" }
        );
        navigator.sendBeacon("/api/chat/finalize", blob);
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [messages.length]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);

  // Auto-scroll to bottom when messages change, but only if the user
  // is already near the bottom. If they've scrolled up to read earlier
  // content, don't yank them back down on every streaming chunk.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distFromBottom < 150) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  // Read an image file as base64 (without the data URL prefix, just the raw base64)
  function readImageAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Strip the "data:image/png;base64," prefix
        const base64 = result.split(",")[1] || result;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Read an image as a data URL for preview
  function readImageAsDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Quickly attach a file. For images we read the data URL for preview.
  // For text/PDF we DO NOT process the content yet -- just stash the raw File
  // and let sendMessage extract the content when the user actually clicks send.
  async function processFile(file: File): Promise<{
    attached: AttachedFile;
    raw: File | null;
  } | null> {
    if (file.size > MAX_FILE_SIZE) {
      setUploadError(`${file.name} is too large (max 25MB)`);
      return null;
    }

    // Detect type from extension/mime
    const lower = file.name.toLowerCase();
    if (IMAGE_TYPES.includes(file.type)) {
      try {
        const dataURL = await readImageAsDataURL(file);
        return {
          attached: {
            name: file.name,
            type: "image",
            content: dataURL,
            size: file.size,
          },
          raw: null, // images are fully ready, no pending file
        };
      } catch {
        setUploadError(`Failed to read image: ${file.name}`);
        return null;
      }
    }

    if (lower.endsWith(".pdf")) {
      return {
        attached: { name: file.name, type: "pdf", size: file.size },
        raw: file, // defer processing to submit
      };
    }

    // Treat anything else attempted as text-ish
    return {
      attached: { name: file.name, type: "text", size: file.size },
      raw: file, // defer processing to submit
    };
  }

  async function handleFiles(files: FileList | File[]) {
    setUploadError(null);
    const fileArray = Array.from(files);
    const results = await Promise.all(fileArray.map(processFile));
    const valid = results.filter(
      (r): r is { attached: AttachedFile; raw: File | null } => r !== null
    );
    if (valid.length > 0) {
      setAttachedFiles((prev) => [...prev, ...valid.map((v) => v.attached)]);
      setPendingRawFiles((prev) => [...prev, ...valid.map((v) => v.raw)]);
    }
  }

  // Resolve a pending text/PDF file by sending it to /api/upload
  async function resolvePendingFile(file: File): Promise<{ content: string; images?: string[] } | null> {
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        setUploadError(err.error || `Failed to process ${file.name}`);
        return null;
      }
      const data = (await res.json()) as { content: string; images?: string[] };
      return { content: data.content, images: data.images };
    } catch {
      setUploadError(`Upload failed: ${file.name}`);
      return null;
    }
  }

  function handleFileInputChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
      e.target.value = ""; // reset so the same file can be picked twice
    }
  }

  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target) setIsDragging(false);
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }

  function removeAttachment(index: number) {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
    setPendingRawFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function sendMessage(e: FormEvent) {
    e.preventDefault();
    if ((!input.trim() && attachedFiles.length === 0) || isStreaming) return;

    // Resolve pending text/PDF files now (extract content via /api/upload).
    // Images are already ready.
    let messageContent = input.trim();
    const images: string[] = [];

    for (let i = 0; i < attachedFiles.length; i++) {
      const file = attachedFiles[i];
      if (file.type === "image") {
        const dataUrl = file.content || "";
        const base64 = dataUrl.split(",")[1] || dataUrl;
        images.push(base64);
        continue;
      }

      // Text or PDF: resolve content now if not already resolved
      let content = file.content;
      let pdfImages: string[] | undefined;
      if (!content) {
        const raw = pendingRawFiles[i];
        if (!raw) {
          setUploadError(`Missing file data for ${file.name}`);
          return;
        }
        const resolved = await resolvePendingFile(raw);
        if (resolved == null) {
          return;
        }
        content = resolved.content;
        pdfImages = resolved.images;
      }

      if (content) {
        const header = messageContent ? "\n\n" : "";
        messageContent += `${header}--- ${file.name} ---\n${content}\n--- end ${file.name} ---`;
      }

      // PDF page images — send to the LLM so it can see charts, diagrams, etc.
      if (pdfImages?.length) {
        images.push(...pdfImages);
      }
    }

    // Anthropic requires non-empty content on every message.
    // If only images with no typed text, use a minimal prompt.
    if (!messageContent && images.length > 0) {
      messageContent = "[image attached]";
    }

    const userMessage: Message = {
      role: "user",
      content: messageContent,
      ...(images.length > 0 ? { images } : {}),
    };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setAttachedFiles([]);
    setPendingRawFiles([]);
    setUploadError(null);
    setIsStreaming(true);

    // Add empty assistant message that we'll fill in as the stream comes in
    setMessages([...newMessages, { role: "assistant", content: "" }]);

    try {
      const abort = new AbortController();
      abortRef.current = abort;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages,
          mode,
          chatId,
          ...(selectedProviderId
            ? { providerId: selectedProviderId, model: selectedProviderModel || undefined }
            : { model: selectedModel }),
          webSearch,
          thinking: thinkingEnabled,
          privateMode,
        }),
        signal: abort.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`Request failed: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Typewriter rendering. Uses setInterval instead of requestAnimationFrame
      // so it keeps running in background tabs. Adaptive drain rate: when the
      // buffer is small, drain slowly for a smooth effect. When the buffer is
      // large (LLM is faster than rendering), drain in bigger chunks so the
      // text doesn't lag seconds behind the actual generation.
      let pendingText = "";
      let displayedText = "";
      let streamFinished = false;

      const drainInterval = setInterval(() => {
        if (pendingText.length === 0) {
          if (streamFinished) clearInterval(drainInterval);
          return;
        }
        // Adaptive: drain more chars when backlog is large
        const charsToTake = pendingText.length > 100
          ? Math.min(50, pendingText.length)  // big backlog: flush fast
          : pendingText.length > 20
            ? Math.min(10, pendingText.length) // medium backlog
            : Math.min(3, pendingText.length); // small: smooth typewriter
        displayedText += pendingText.slice(0, charsToTake);
        pendingText = pendingText.slice(charsToTake);
        const snapshot = displayedText;
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content: snapshot,
          };
          return updated;
        });
      }, 16); // ~60fps

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);
            try {
              const chunk = JSON.parse(data) as {
                delta?: string;
                done?: boolean;
                error?: string;
                chatId?: string;
              };
              if (chunk.chatId) {
                setChatId(chunk.chatId);
                chatIdRef.current = chunk.chatId; // set ref immediately, don't wait for re-render
                continue;
              }
              if (chunk.error) {
                pendingText += `Error: ${chunk.error}`;
                continue;
              }
              if (chunk.delta) {
                pendingText += chunk.delta;
              }
            } catch {
              // skip malformed lines
            }
          }
        }
      } finally {
        // Mark stream finished. The interval will clear itself once
        // pendingText is drained. Flush any remaining text immediately
        // so the user doesn't wait for the interval to tick.
        streamFinished = true;
        if (pendingText.length > 0) {
          displayedText += pendingText;
          pendingText = "";
          const snapshot = displayedText;
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              role: "assistant",
              content: snapshot,
            };
            return updated;
          });
        }
        clearInterval(drainInterval);
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        // User clicked stop. Remove the empty assistant message if
        // nothing was generated, keep it if partial content exists.
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && !last.content?.trim()) {
            return prev.slice(0, -1);
          }
          return prev;
        });
      } else {
        const message = err instanceof Error ? err.message : "Unknown error";
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: `Error: ${message}` };
          return updated;
        });
      }
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
      refreshChatList();

      // Poll for the title to appear (server generates it fire-and-forget after
      // the response stream finishes). Stops as soon as the title is set or
      // after a 15-second timeout.
      const activeId = chatIdRef.current;
      if (activeId) {
        pollForChatTitle(activeId).catch(() => {
          // Silent fail. The title will appear on the next manual refresh.
        });
      }
    }
  }

  function stopStreaming() {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(e as unknown as FormEvent);
    }
  }

  async function newChat() {
    if (isStreaming || isFinalizing) return;

    // If there's an active chat with content, finalize it (extract facts, rebuild profile)
    // before clearing. This guarantees the next conversation can see the new memories.
    if (chatId && messages.length >= 2) {
      setIsFinalizing(true);
      try {
        await fetch("/api/chat/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId }),
        });
      } catch (err) {
        console.error("Finalize failed:", err);
      } finally {
        setIsFinalizing(false);
      }
    }

    setMessages([]);
    setInput("");
    setChatId(null);
  }

  return (
    <div
      className="flex h-screen bg-zinc-50 dark:bg-zinc-950 relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Sidebar */}
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        chats={chatList}
        activeChatId={chatId}
        onLoadChat={loadChat}
        onDeleteChat={deleteChat}
        onTogglePin={togglePin}
        onNewChat={newChat}
        isStreaming={isStreaming}
        isFinalizing={isFinalizing}
        activeBrain={activeBrain}
        brains={brains}
        onSwitchBrain={switchBrain}
        onAddBrain={addBrain}
        onDeleteBrain={deleteBrain}
        onRenameBrain={renameBrain}
        showBrainPicker={showBrainPicker}
      />

      {/* Main column */}
      <div className="flex flex-col flex-1 min-w-0 h-screen">
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 transition-colors"
              title="Open sidebar"
            >
              <SidebarIcon />
            </button>
          )}
          {/* Only show the logo + name in the chat header when the sidebar is
              closed. When it's open, the sidebar already shows them. */}
          {!sidebarOpen && (
            <>
              <Logo size={20} className="text-zinc-900 dark:text-zinc-100" />
              <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                RecallMEM
              </h1>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                Local · Private
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {isFinalizing && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-400 animate-pulse" />
              Saving memory...
            </span>
          )}
          <ModelPicker
            modelId={selectedModel}
            providerId={selectedProviderId}
            selectedModel={selectedProviderModel}
            onSelectOllama={handleOllamaSelect}
            onSelectProvider={(id, model) => {
              setSelectedProviderId(id);
              setSelectedProviderModel(model || null);
            }}
            customProviders={customProviders}
            disabled={isStreaming || isFinalizing}
          />
          <div className="group relative">
            <button
              onClick={() => setPrivateMode((v) => !v)}
              className={`w-9 h-9 flex items-center justify-center rounded-md border transition-colors ${
                privateMode
                  ? "border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400"
                  : "border-zinc-200 dark:border-zinc-800 text-zinc-400 dark:text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
              title={privateMode ? "Private mode on" : "Private mode off"}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </button>
            <span className="pointer-events-none absolute top-full right-0 mt-1.5 px-2.5 py-1.5 text-[10px] font-medium leading-snug rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 opacity-0 group-hover:opacity-100 transition-opacity shadow-md z-50 w-52">
              {privateMode
                ? "Private mode ON. Your memory, profile, and facts are NOT sent to the cloud LLM. Only your rules and the current message."
                : "Private mode OFF. Your memory context is included for better responses."}
            </span>
          </div>
          <Link
            href="/settings"
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-700 dark:text-zinc-300"
          >
            Settings
          </Link>
          <Link
            href="/memory"
            title="Memory"
            aria-label="Memory"
            className="group relative p-2 rounded-md border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-700 dark:text-zinc-300"
          >
            <BrainIcon />
            {/* Custom tooltip on hover (in addition to the native title attribute) */}
            <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 text-[10px] font-medium rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap shadow-md z-50">
              Memory
            </span>
          </Link>
          <ThemeToggle />
          {/* Unrestricted mode hidden until vMLX + abliterated Gemma 4 is set up. See TODO.md */}
          <button
            onClick={newChat}
            disabled={isStreaming || isFinalizing || messages.length === 0}
            title="New chat"
            aria-label="New chat"
            className="group relative w-9 h-9 flex items-center justify-center rounded-md border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-zinc-700 dark:text-zinc-300"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span className="pointer-events-none absolute top-full right-0 mt-1.5 px-2 py-1 text-[10px] font-medium rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap shadow-md z-50">
              New chat
            </span>
          </button>
        </div>
      </header>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto relative"
        onScroll={() => {
          const el = scrollRef.current;
          if (!el) return;
          const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
          setShowScrollDown(distFromBottom > 300);
        }}
      >
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
          {messages.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-zinc-500 dark:text-zinc-400 text-sm">
                Start a conversation. Everything stays on your machine.
                <br />
                <span className="text-zinc-400 dark:text-zinc-600 text-xs">
                  Cloud LLMs (Anthropic, OpenAI, etc.) only see what you send them.
                </span>
              </p>
            </div>
          ) : (
            messages.map((msg, i) => <MessageBubble key={i} message={msg} onSpeak={speakText} isSpeaking={isSpeaking} ttsLoading={ttsLoading} />)
          )}
        </div>
      </div>

      {/* Scroll-to-bottom button — appears when user has scrolled up */}
      {showScrollDown && (
        <div className="flex justify-center -mt-6 mb-2 relative z-10">
          <button
            onClick={() =>
              scrollRef.current?.scrollTo({
                top: scrollRef.current.scrollHeight,
                behavior: "smooth",
              })
            }
            className="w-8 h-8 rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-300 dark:hover:bg-zinc-700 flex items-center justify-center shadow-md transition-colors"
            title="Scroll to bottom"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      )}

      {/* Empty state banner: no Gemma installed AND no cloud provider configured */}
      {noChatBackend && (
        <div className="border-t border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-6 py-4">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 flex items-center justify-center text-lg font-bold">
                ⚡
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-amber-900 dark:text-amber-100 mb-1">
                  Get chatting in 30 seconds
                </div>
                <p className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed mb-3">
                  Pick how you want to use RecallMEM. You can do both later.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href="/providers"
                    className="px-3 py-1.5 text-xs font-medium rounded-md bg-amber-600 hover:bg-amber-700 text-white transition-colors"
                  >
                    Add a Claude or OpenAI key (~30 sec) →
                  </Link>
                  <Link
                    href="/settings"
                    className="px-3 py-1.5 text-xs font-medium rounded-md border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-100 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                  >
                    Download Gemma 4 (private mode) →
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Idle mic prompt */}
      {idlePrompt && (
        <div className="flex items-center justify-center gap-3 py-3 px-4 bg-amber-50 dark:bg-amber-950/30 border-t border-amber-200 dark:border-amber-800">
          <span className="text-sm text-amber-700 dark:text-amber-300">
            Still listening? Stopping in <strong>{idleCountdown}s</strong>
          </span>
          <button
            onClick={dismissIdlePrompt}
            className="px-3 py-1 text-sm font-medium bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-colors"
          >
            Yes, I&apos;m here
          </button>
          <button
            onClick={stopRecording}
            className="px-3 py-1 text-sm font-medium border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 rounded-md hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
          >
            Stop
          </button>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
        <form onSubmit={sendMessage} className="max-w-3xl mx-auto">
          {/* Attached file chips */}
          {(attachedFiles.length > 0 || uploadError) && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachedFiles.map((file, i) => (
                <FileChip key={i} file={file} onRemove={() => removeAttachment(i)} />
              ))}
              {uploadError && (
                <div className="text-xs text-red-600 dark:text-red-400 flex items-center px-2">
                  {uploadError}
                </div>
              )}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.txt,.md,.json,.csv,.yaml,.yml,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.c,.cpp,.cs,.php,.swift,.sh,.sql,.html,.css"
            onChange={handleFileInputChange}
            className="hidden"
          />
          <div className="flex items-center gap-1 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2 focus-within:ring-2 focus-within:ring-zinc-300 dark:focus-within:ring-zinc-700">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isStreaming}
              className="flex-shrink-0 w-8 h-8 rounded-full text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Attach file"
            >
              <PaperclipIcon />
            </button>
            {(() => {
              const sel = customProviders.find((p) => p.id === selectedProviderId);
              const isLocal = !selectedProviderId;
              const isAnthropic = sel?.type === "anthropic";
              const isOllamaCustom = sel?.type === "ollama";
              const supportsWebSearch = isAnthropic || isLocal || isOllamaCustom || sel?.type === "openai" || sel?.type === "openai-compatible";
              if (!supportsWebSearch) return null;
              const isThirdParty = isLocal || isOllamaCustom;
              return (
                <div className="flex-shrink-0 group relative">
                  <button
                    type="button"
                    onClick={() => {
                      if (!webSearch) {
                        if (isThirdParty) {
                          const acknowledged = localStorage.getItem("recallmem.webSearchAcknowledged");
                          if (!acknowledged) { setShowWebSearchWarning(true); return; }
                        }
                        setWebSearch(true);
                      } else {
                        setWebSearch(false);
                      }
                    }}
                    disabled={isStreaming}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                      webSearch
                        ? "bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400"
                        : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    }`}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M2 12h20" />
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                  </button>
                  <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 text-[10px] font-medium leading-snug rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap shadow-md z-50">
                    {webSearch
                      ? isThirdParty ? "Web search on - queries go to Brave" : "Web search on"
                      : isThirdParty ? "Web search off - click to enable (uses Brave)" : "Web search off"}
                  </span>
                </div>
              );
            })()}
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={noChatBackend ? "Set up a model first ↑" : isRecording ? "Listening..." : "Ask me anything"}
              rows={1}
              disabled={noChatBackend}
              className="flex-1 resize-none bg-transparent py-3 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none disabled:opacity-50"
            />
            {/* Mic button — STT dictation */}
            <button
              type="button"
              onClick={isRecording ? stopRecording : startRecording}
              disabled={noChatBackend || isStreaming}
              className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                isRecording
                  ? "bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400 animate-pulse"
                  : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
              title={isRecording ? "Stop listening" : "Voice input (Whisper)"}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            </button>
            {/* Voice Agent button — disabled for now, needs more work */}
            {isStreaming ? (
              <button
                type="button"
                onClick={stopStreaming}
                className="flex-shrink-0 w-8 h-8 rounded-full bg-red-600 text-white flex items-center justify-center hover:bg-red-700 transition-colors"
                title="Stop generating"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                type="submit"
                disabled={(!input.trim() && attachedFiles.length === 0) || noChatBackend}
                className="flex-shrink-0 w-8 h-8 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
              >
                <ArrowUpIcon />
              </button>
            )}
          </div>
        </form>
      </div>

      </div>
      {/* /Main column */}

      {/* Drag overlay */}
      {isDragging && (
        <div
          className="absolute inset-0 z-50 bg-zinc-900/40 dark:bg-zinc-950/60 backdrop-blur-sm flex items-center justify-center cursor-pointer"
          onClick={() => setIsDragging(false)}
        >
          <div className="bg-white dark:bg-zinc-900 border-2 border-dashed border-zinc-400 dark:border-zinc-600 rounded-2xl px-12 py-8 text-center pointer-events-none">
            <div className="text-zinc-700 dark:text-zinc-200 font-medium">Drop files to attach</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              Images, PDFs, text, code
            </div>
          </div>
        </div>
      )}

      {/* Brain picker hidden hint */}
      {showBrainHint && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowBrainHint(false)}>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-6 py-5 max-w-xs text-center shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
              Brain picker hidden
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-4">
              To show it again, press:
            </p>
            <div className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-xs font-mono text-zinc-900 dark:text-zinc-100">
              {typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘" : "Ctrl"} + Shift + H
            </div>
            <label className="flex items-center justify-center gap-2 mt-4 text-xs text-zinc-500 dark:text-zinc-400 cursor-pointer">
              <input
                type="checkbox"
                onChange={(e) => {
                  if (e.target.checked) {
                    localStorage.setItem(
                      "recallmem.brainHintMuted",
                      String(Date.now() + 7 * 24 * 60 * 60 * 1000)
                    );
                  } else {
                    localStorage.removeItem("recallmem.brainHintMuted");
                  }
                }}
                className="w-3.5 h-3.5 rounded cursor-pointer"
              />
              Don&apos;t show this for 7 days
            </label>
            <button
              onClick={() => setShowBrainHint(false)}
              className="block w-full mt-3 px-4 py-2 text-xs font-medium rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {/* Model download modal - shown when user picks an unavailable Ollama model */}
      {pendingDownloadModel && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { setPendingDownloadModel(null); setDownloadProgress(null); setDownloadError(null); }}>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 max-w-md w-full shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
              Download {MODEL_OPTIONS.find((m) => m.id === pendingDownloadModel)?.label || pendingDownloadModel}?
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4 leading-relaxed">
              {MODEL_OPTIONS.find((m) => m.id === pendingDownloadModel)?.description}
            </p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-5">
              <strong>
                ~{MODEL_OPTIONS.find((m) => m.id === pendingDownloadModel)?.sizeGB} GB
              </strong>{" "}
              download. This can take a few minutes to half an hour depending on the size and your internet speed.
            </p>

            {downloadProgress && (
              <div className="mb-5">
                <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">
                  {downloadProgress.status}
                  {downloadProgress.completed && downloadProgress.total ? (
                    <span>
                      {" "}
                      — {(downloadProgress.completed / 1e9).toFixed(2)} GB / {(downloadProgress.total / 1e9).toFixed(2)} GB
                    </span>
                  ) : null}
                </div>
                <div className="w-full h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all duration-300"
                    style={{
                      width:
                        downloadProgress.completed && downloadProgress.total
                          ? `${Math.round((downloadProgress.completed / downloadProgress.total) * 100)}%`
                          : "5%",
                    }}
                  />
                </div>
              </div>
            )}

            {downloadError && (
              <div className="mb-5 text-sm text-red-600 dark:text-red-400">
                {downloadError}
              </div>
            )}

            <div className="flex gap-2 justify-end">
              {downloadProgress && !downloadError ? (
                <button
                  onClick={() => cancelModelDownload(pendingDownloadModel)}
                  className="px-4 py-2 text-sm font-medium rounded-md border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                >
                  Cancel download
                </button>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setPendingDownloadModel(null);
                      setDownloadProgress(null);
                      setDownloadError(null);
                    }}
                    className="px-4 py-2 text-sm font-medium rounded-md border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => startModelDownload(pendingDownloadModel)}
                    className="px-4 py-2 text-sm font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors"
                  >
                    Download
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Voice Agent modal */}
      {showVoiceAgent && (
        <VoiceAgent onClose={() => setShowVoiceAgent(false)} />
      )}

      {/* First-time web search privacy warning (local providers only) */}
      {showWebSearchWarning && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { setShowWebSearchWarning(false); setDontShowWebSearchWarning(false); }}>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 max-w-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
              Web search needs a free Brave Search API key
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4 leading-relaxed">
              Local models (Gemma) can&apos;t browse the web on their own, so RecallMEM uses Brave Search as a backend. Brave gives you $5 in free credits every month, which covers about 1,000 searches.
            </p>

            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-3 mb-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">
                Setup (one time, ~5 minutes)
              </div>
              <ol className="text-sm text-zinc-700 dark:text-zinc-300 space-y-1.5 list-decimal list-inside">
                <li>
                  Sign up at{" "}
                  <a
                    href="https://brave.com/search/api"
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 dark:text-blue-400 underline"
                  >
                    brave.com/search/api
                  </a>
                </li>
                <li>Pick the Free tier and grab your API key</li>
                <li>
                  Paste it into{" "}
                  <Link
                    href="/settings"
                    className="text-blue-600 dark:text-blue-400 underline"
                  >
                    Settings
                  </Link>{" "}
                  and click Save
                </li>
              </ol>
              <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">
                If you skip this, the toggle still works but the AI will tell you to set up the key.
              </div>
            </div>

            <div className="text-sm space-y-2 mb-5">
              <div className="text-zinc-700 dark:text-zinc-300">
                <strong>Brave will see:</strong> the text of your message (used as the search query)
              </div>
              <div className="text-zinc-700 dark:text-zinc-300">
                <strong>Brave will NOT see:</strong> your memory, profile, facts, past conversations, or anything else stored locally
              </div>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-500 mb-4">
              You can turn web search off at any time.
            </p>
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 mb-5 cursor-pointer">
              <input
                type="checkbox"
                checked={dontShowWebSearchWarning}
                onChange={(e) => setDontShowWebSearchWarning(e.target.checked)}
                className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-700 cursor-pointer"
              />
              Don&apos;t show this again
            </label>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowWebSearchWarning(false);
                  setDontShowWebSearchWarning(false);
                }}
                className="px-4 py-2 text-sm font-medium rounded-md border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (dontShowWebSearchWarning) {
                    localStorage.setItem("recallmem.webSearchAcknowledged", "true");
                  }
                  setWebSearch(true);
                  setShowWebSearchWarning(false);
                  setDontShowWebSearchWarning(false);
                }}
                className="px-4 py-2 text-sm font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors"
              >
                Got it, enable web search
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Sidebar({
  open,
  onClose,
  chats,
  activeChatId,
  onLoadChat,
  onDeleteChat,
  onTogglePin,
  onNewChat,
  isStreaming,
  isFinalizing,
  activeBrain,
  brains,
  onSwitchBrain,
  onAddBrain,
  onDeleteBrain,
  onRenameBrain,
  showBrainPicker,
}: {
  open: boolean;
  onClose: () => void;
  chats: ChatListItem[];
  activeChatId: string | null;
  onLoadChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
  onTogglePin: (id: string, currentlyPinned: boolean) => void;
  onNewChat: () => void;
  isStreaming: boolean;
  isFinalizing: boolean;
  activeBrain: string;
  brains: { name: string; emoji: string }[];
  onSwitchBrain: (slug: string) => void;
  onAddBrain: (name: string) => void;
  onDeleteBrain: (slug: string) => void;
  onRenameBrain: (slug: string) => void;
  showBrainPicker: boolean;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"vector" | "text">("vector");
  const [matchedIds, setMatchedIds] = useState<Set<string> | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  // Load search mode preference
  useEffect(() => {
    const saved = localStorage.getItem("recallmem.searchMode");
    if (saved === "text" || saved === "vector") setSearchMode(saved);
  }, []);
  useEffect(() => {
    localStorage.setItem("recallmem.searchMode", searchMode);
  }, [searchMode]);

  // Debounced search: text mode is instant client-side, vector hits server
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setMatchedIds(null);
      return;
    }
    // Both modes hit the server: text mode runs ILIKE against title +
    // transcript, vector mode embeds the query and ranks chunks by cosine
    // similarity. Debounced 300ms either way.
    setIsSearching(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/chats/search?mode=${searchMode}&q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const json = (await res.json()) as { chatIds: string[] };
          setMatchedIds(new Set(json.chatIds));
        }
      } catch (err) {
        console.error("[sidebar] search failed:", err);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [searchQuery, searchMode]);

  if (!open) return null;

  // Apply search filter, then split into pinned and unpinned, then group by date
  const filtered = matchedIds ? chats.filter((c) => matchedIds.has(c.id)) : chats;
  const pinned = filtered.filter((c) => c.is_pinned);
  const unpinned = filtered.filter((c) => !c.is_pinned);
  const dateGroups = groupChatsByDate(unpinned);

  return (
    <aside className="w-64 flex-shrink-0 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col">
      {/* Header */}
      <div className="px-3 py-3 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2 px-2">
          <Logo size={16} className="text-zinc-900 dark:text-zinc-100" />
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            RecallMEM
          </h2>
          <span className="text-[9px] text-zinc-400 dark:text-zinc-600">
            v{process.env.NEXT_PUBLIC_APP_VERSION}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition-colors"
          title="Close sidebar"
        >
          <SidebarIcon />
        </button>
      </div>

      {/* New chat button */}
      <div className="p-2">
        <button
          onClick={onNewChat}
          disabled={isStreaming || isFinalizing}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-zinc-700 dark:text-zinc-300"
        >
          <PlusIcon />
          New chat
        </button>
      </div>

      {/* Brain picker — Cmd+Shift+H to toggle visibility.
          Uses CSS hidden instead of conditional render to avoid flash on refresh. */}
      <div data-brain-picker className={showBrainPicker ? "" : "hidden"}>
        <BrainPicker
          brains={brains}
          activeBrain={activeBrain}
          onSwitch={onSwitchBrain}
          onAdd={onAddBrain}
          onRename={onRenameBrain}
          onDelete={onDeleteBrain}
        />
      </div>

      {/* Search */}
      <div className="px-2 pb-2 space-y-1.5">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="w-full text-sm px-3 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-700"
          />
          {isSearching && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-zinc-400 animate-pulse" />
          )}
        </div>
        <div className="relative group flex items-center justify-between px-1 py-0.5">
          <span className="text-[10px] text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-700 dark:group-hover:text-zinc-200">
            Vector search
          </span>
          <button
            type="button"
            onClick={() => setSearchMode(searchMode === "vector" ? "text" : "vector")}
            className={`relative inline-flex items-center w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
              searchMode === "vector" ? "bg-blue-600" : "bg-zinc-300 dark:bg-zinc-700"
            }`}
          >
            <span
              className={`inline-block w-4 h-4 rounded-full bg-white shadow transform transition-transform ${
                searchMode === "vector" ? "translate-x-[18px]" : "translate-x-0.5"
              }`}
            />
          </button>
          <span className="pointer-events-none absolute left-0 right-0 top-full mt-1.5 px-2.5 py-1.5 text-[10px] font-medium leading-snug rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 opacity-0 group-hover:opacity-100 transition-opacity shadow-md z-50">
            {searchMode === "vector"
              ? "ON: semantic search across full conversation content using embeddings. Finds chats by meaning, not just exact words. Needs Ollama running."
              : "OFF: literal text matching across titles and full transcripts. Instant, works on any hardware, but only finds exact word matches."}
          </span>
        </div>
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {chats.length === 0 ? (
          <div className="px-3 py-8 text-xs text-zinc-500 dark:text-zinc-400 text-center">
            No conversations yet
          </div>
        ) : (
          <>
            {pinned.length > 0 && (
              <div className="mb-4">
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-500 flex items-center gap-1">
                  <StarFilledIcon />
                  Pinned
                </div>
                <div className="space-y-0.5">
                  {pinned.map((chat) => (
                    <ChatListRow
                      key={chat.id}
                      chat={chat}
                      isActive={chat.id === activeChatId}
                      onClick={() => onLoadChat(chat.id)}
                      onDelete={() => onDeleteChat(chat.id)}
                      onTogglePin={() => onTogglePin(chat.id, chat.is_pinned)}
                      onRename={() => {
                        const newTitle = prompt("Rename chat:", chat.title || "");
                        if (newTitle) {
                          fetch(`/api/chats/${chat.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ title: newTitle }),
                          }).then(() => window.location.reload());
                        }
                      }}
                      disabled={isStreaming || isFinalizing}
                    />
                  ))}
                </div>
              </div>
            )}
            {dateGroups.map((group) => (
              <div key={group.label} className="mb-4">
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-500">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {group.chats.map((chat) => (
                    <ChatListRow
                      key={chat.id}
                      chat={chat}
                      isActive={chat.id === activeChatId}
                      onClick={() => onLoadChat(chat.id)}
                      onDelete={() => onDeleteChat(chat.id)}
                      onTogglePin={() => onTogglePin(chat.id, chat.is_pinned)}
                      onRename={() => {
                        const newTitle = prompt("Rename chat:", chat.title || "");
                        if (newTitle) {
                          fetch(`/api/chats/${chat.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ title: newTitle }),
                          }).then(() => window.location.reload());
                        }
                      }}
                      disabled={isStreaming || isFinalizing}
                    />
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Footer with copyright and social links */}
      <AppFooter />
    </aside>
  );
}

function ChatListRow({
  chat,
  isActive,
  onClick,
  onDelete,
  onTogglePin,
  onRename,
  disabled,
}: {
  chat: ChatListItem;
  isActive: boolean;
  onClick: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
  onRename: () => void;
  disabled: boolean;
}) {
  return (
    <div
      className={`group relative rounded-lg ${
        isActive
          ? "bg-zinc-100 dark:bg-zinc-800"
          : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
      }`}
    >
      <button
        onClick={onClick}
        disabled={disabled}
        className="w-full text-left px-3 py-2 pr-14 text-sm text-zinc-700 dark:text-zinc-300 truncate disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {chat.title || "Untitled"}
      </button>
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
          disabled={disabled}
          className={`w-6 h-6 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 flex items-center justify-center transition-opacity disabled:cursor-not-allowed ${
            chat.is_pinned
              ? "opacity-100 text-amber-500"
              : "opacity-0 group-hover:opacity-100 text-zinc-500 dark:text-zinc-400"
          }`}
          title={chat.is_pinned ? "Unpin chat" : "Pin chat"}
        >
          {chat.is_pinned ? <StarFilledIcon /> : <StarIcon />}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          disabled={disabled}
          className="w-6 h-6 rounded opacity-0 group-hover:opacity-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 flex items-center justify-center text-zinc-500 dark:text-zinc-400 transition-opacity disabled:cursor-not-allowed"
          title="Delete chat"
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  );
}

function StarIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function StarFilledIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function groupChatsByDate(chats: ChatListItem[]): {
  label: string;
  chats: ChatListItem[];
}[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const groups: Record<string, ChatListItem[]> = {
    Today: [],
    Yesterday: [],
    "Previous 7 days": [],
    "Previous 30 days": [],
    Older: [],
  };

  for (const chat of chats) {
    const updated = new Date(chat.updated_at);
    if (updated >= today) groups["Today"].push(chat);
    else if (updated >= yesterday) groups["Yesterday"].push(chat);
    else if (updated >= sevenDaysAgo) groups["Previous 7 days"].push(chat);
    else if (updated >= thirtyDaysAgo) groups["Previous 30 days"].push(chat);
    else groups["Older"].push(chat);
  }

  return Object.entries(groups)
    .filter(([, list]) => list.length > 0)
    .map(([label, chats]) => ({ label, chats }));
}

function BrainPicker({
  brains,
  activeBrain,
  onSwitch,
  onAdd,
  onRename,
  onDelete,
}: {
  brains: { name: string; emoji: string }[];
  activeBrain: string;
  onSwitch: (slug: string) => void;
  onAdd: (name: string) => void;
  onRename: (slug: string) => void;
  onDelete: (slug: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = brains.find((b) => b.name === activeBrain) || brains[0];

  return (
    <div className="px-2 pb-2 relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-2 py-1.5 text-xs rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
      >
        <span>
          {active.emoji} {active.name === "default" ? "Default Brain" : active.name.charAt(0).toUpperCase() + active.name.slice(1)}
        </span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-2 right-2 top-full mt-1 z-50 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-lg overflow-hidden">
            {brains.map((b) => (
              <div
                key={b.name}
                className={`group flex items-center justify-between px-2 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer ${
                  b.name === activeBrain ? "bg-zinc-50 dark:bg-zinc-800 font-medium" : ""
                }`}
              >
                <button
                  className="flex-1 text-left text-zinc-700 dark:text-zinc-300"
                  onClick={() => { onSwitch(b.name); setOpen(false); }}
                >
                  {b.emoji} {b.name === "default" ? "Default Brain" : b.name.charAt(0).toUpperCase() + b.name.slice(1)}
                </button>
                {b.name !== "default" && (
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); onRename(b.name); }}
                      className="p-1 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                      title="Rename"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(b.name); setOpen(false); }}
                      className="p-1 rounded text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                      title="Delete"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            ))}
            <button
              onClick={() => {
                const name = prompt("Name for the new brain:");
                if (name) { onAdd(name); setOpen(false); }
              }}
              className="w-full text-left px-2 py-2 text-xs text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 border-t border-zinc-100 dark:border-zinc-800"
            >
              + New brain...
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SidebarIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

function BrainIcon() {
  // Lucide "brain" icon -- two hemispheres in line-art style
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 0 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 0 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
      <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
      <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
      <path d="M3.477 10.896a4 4 0 0 1 .585-.396m0 0c.34-.225.674-.4 1-.508a3 3 0 0 1 1.45-.246" />
      <path d="M6 18a4 4 0 0 1-1.967-.516" />
      <path d="M19.967 17.484A4 4 0 0 1 18 18" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

const MessageBubble = memo(function MessageBubble({ message, onSpeak, isSpeaking, ttsLoading }: { message: Message; onSpeak?: (text: string) => void; isSpeaking?: boolean; ttsLoading?: boolean }) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  // Parse <think>...</think> from assistant content for display.
  // Handles both complete (closed tag) and in-progress (unclosed) thinking.
  let thinkContent: string | null = null;
  let thinkingInProgress = false;
  let displayContent = message.content;
  if (!isUser && message.content) {
    const closedMatch = message.content.match(/^<think>([\s\S]*?)<\/think>\s*/);
    if (closedMatch) {
      thinkContent = closedMatch[1].trim();
      displayContent = message.content.slice(closedMatch[0].length);
    } else if (message.content.startsWith("<think>")) {
      // Thinking is still streaming — no closing tag yet
      thinkContent = message.content.slice(7).trim();
      displayContent = "";
      thinkingInProgress = true;
    }
  }

  function copyToClipboard() {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className={`group flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`relative max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 whitespace-pre-wrap"
            : "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100"
        }`}
      >
        {message.images && message.images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {message.images.map((img, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={`data:image/png;base64,${img}`}
                alt={`attachment ${i + 1}`}
                className="max-w-[200px] max-h-[200px] rounded-lg object-cover"
              />
            ))}
          </div>
        )}
        {thinkContent && (
          <details className="mb-3" open={thinkingInProgress}>
            <summary className="text-xs text-amber-600 dark:text-amber-400 cursor-pointer hover:underline">
              {thinkingInProgress ? "Thinking..." : "Thought process"}
            </summary>
            <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400 italic whitespace-pre-wrap leading-relaxed border-l-2 border-amber-300 dark:border-amber-800 pl-3">
              {thinkContent}
            </div>
          </details>
        )}
        {!displayContent && !thinkingInProgress ? (
          <TypingDots />
        ) : isUser ? (
          displayContent
        ) : displayContent ? (
          <MarkdownContent content={displayContent} />
        ) : null}
        {/* Copy button — inside bubble, top-right, appears on hover */}
        {message.content && (
          <div className={`absolute top-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity`}>
            {/* Speaker button — cloud TTS if available, else browser SpeechSynthesis */}
            {!isUser && onSpeak && (
              <button
                onClick={() => onSpeak(displayContent)}
                className={`p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                  ttsLoading ? "text-zinc-400 animate-spin" : isSpeaking ? "text-blue-500" : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                }`}
                title={ttsLoading ? "Loading..." : isSpeaking ? "Stop speaking" : "Read aloud"}
              >
                {ttsLoading ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                ) : isSpeaking ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  </svg>
                )}
              </button>
            )}
          <button
            onClick={copyToClipboard}
            className={`p-1 rounded ${
              isUser
                ? "text-white/50 hover:text-white hover:bg-white/10"
                : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
            title="Copy to clipboard"
          >
            {copied ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
          </div>
        )}
      </div>
    </div>
  );
});

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose prose-sm prose-zinc dark:prose-invert max-w-none prose-p:my-2 prose-headings:mt-4 prose-headings:mb-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-pre:my-2 prose-code:before:content-none prose-code:after:content-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

// Animated typing indicator. Three dots that bounce in sequence.
// Used while waiting for the first chunk of an assistant response.
function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1">
      <span
        className="w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500 animate-bounce"
        style={{ animationDelay: "0ms", animationDuration: "1s" }}
      />
      <span
        className="w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500 animate-bounce"
        style={{ animationDelay: "150ms", animationDuration: "1s" }}
      />
      <span
        className="w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500 animate-bounce"
        style={{ animationDelay: "300ms", animationDuration: "1s" }}
      />
    </span>
  );
}

function FileChip({
  file,
  onRemove,
}: {
  file: AttachedFile;
  onRemove: () => void;
}) {
  const isImage = file.type === "image";
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300 max-w-[240px]">
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={file.content}
          alt={file.name}
          className="w-8 h-8 rounded object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-8 h-8 rounded bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0">
          <FileIcon />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="truncate font-medium">{file.name}</div>
        <div className="text-zinc-500 dark:text-zinc-400 text-[10px] uppercase">
          {file.type}
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="w-5 h-5 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-800 flex items-center justify-center text-zinc-500 dark:text-zinc-400"
      >
        <XIcon />
      </button>
    </div>
  );
}

function PaperclipIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 17.93 8.8l-8.58 8.57a2 2 0 0 1-2.83-2.83l7.86-7.85" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function ModeToggle({
  mode,
  onChange,
  disabled,
}: {
  mode: ModelMode;
  onChange: (mode: ModelMode) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-0.5">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("standard")}
        className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
          mode === "standard"
            ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm"
            : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        Standard
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("unrestricted")}
        className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
          mode === "unrestricted"
            ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm"
            : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        Unrestricted
      </button>
    </div>
  );
}

// Known models per provider type. One API key unlocks all models
// in the group. User picks any model from the dropdown.
const PROVIDER_MODELS: Record<string, { label: string; apiId: string }[]> = {
  anthropic: [
    { label: "Claude Opus 4.6", apiId: "claude-opus-4-6" },
    { label: "Claude Sonnet 4.6", apiId: "claude-sonnet-4-6" },
    { label: "Claude Haiku 4.5", apiId: "claude-haiku-4-5-20251001" },
    { label: "Claude Opus 4.5", apiId: "claude-opus-4-5" },
    { label: "Claude Sonnet 4.5", apiId: "claude-sonnet-4-5" },
  ],
  openai: [
    { label: "GPT-5.4", apiId: "gpt-5.4" },
    { label: "GPT-5.4 Pro", apiId: "gpt-5.4-pro" },
    { label: "GPT-5.4 Mini", apiId: "gpt-5.4-mini" },
    { label: "GPT-5.4 Nano", apiId: "gpt-5.4-nano" },
    { label: "GPT-5", apiId: "gpt-5" },
    { label: "GPT-5 Mini", apiId: "gpt-5-mini" },
    { label: "GPT-4.1", apiId: "gpt-4.1" },
  ],
};

function ModelPicker({
  modelId,
  providerId,
  selectedModel,
  onSelectOllama,
  onSelectProvider,
  customProviders,
  disabled,
}: {
  modelId: ModelId;
  providerId: string | null;
  selectedModel: string | null;
  onSelectOllama: (id: ModelId) => void;
  onSelectProvider: (id: string, model?: string) => void;
  customProviders: ProviderListItem[];
  disabled: boolean;
}) {
  const value = providerId
    ? `provider:${providerId}::${selectedModel || ""}`
    : `ollama:${modelId}`;

  function handleChange(v: string) {
    if (v === "__add_provider__") {
      window.location.href = "/providers";
      return;
    }
    if (v.startsWith("provider:")) {
      const rest = v.slice("provider:".length);
      const sep = rest.indexOf("::");
      if (sep !== -1) {
        const id = rest.slice(0, sep);
        const model = rest.slice(sep + 2);
        onSelectProvider(id, model);
      } else {
        onSelectProvider(rest);
      }
    } else if (v.startsWith("ollama:")) {
      onSelectOllama(v.slice("ollama:".length) as ModelId);
    }
  }

  // Group providers by type. One API key = one optgroup with all models.
  const providersByType = new Map<string, ProviderListItem>();
  for (const p of customProviders) {
    if (!providersByType.has(p.type)) {
      providersByType.set(p.type, p);
    }
  }

  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        disabled={disabled}
        className="appearance-none px-3 py-1.5 pr-8 text-xs font-medium rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-700"
      >
        <optgroup label="Local (Ollama)">
          {MODEL_OPTIONS.map((opt) => (
            <option key={opt.id} value={`ollama:${opt.id}`}>
              {opt.label}
              {opt.recommended ? "  ★ Recommended" : ""}
            </option>
          ))}
        </optgroup>
        {Array.from(providersByType.entries()).map(([type, provider]) => {
          const knownModels = PROVIDER_MODELS[type];
          const label = type === "anthropic" ? "Anthropic (Claude)"
            : type === "openai" ? "OpenAI (GPT)"
            : type === "openai-compatible" ? provider.label
            : type;
          if (knownModels && knownModels.length > 0) {
            return (
              <optgroup key={type} label={label}>
                {knownModels.map((m) => (
                  <option key={m.apiId} value={`provider:${provider.id}::${m.apiId}`}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
            );
          }
          // OpenAI-compatible or unknown type: show the single saved model
          return (
            <optgroup key={provider.id} label={label}>
              <option value={`provider:${provider.id}::${provider.model}`}>
                {provider.label}
              </option>
            </optgroup>
          );
        })}
        <optgroup label="">
          <option value="__add_provider__">+ Add provider...</option>
        </optgroup>
      </select>
      <svg
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-400"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
  );
}

function ArrowUpIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m5 12 7-7 7 7" />
      <path d="M12 19V5" />
    </svg>
  );
}
