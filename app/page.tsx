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
    const POLL_INTERVAL = 700;
    const TIMEOUT_MS = 15000;
    const startedAt = Date.now();

    while (Date.now() - startedAt < TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
      try {
        const res = await fetch("/api/chats");
        if (!res.ok) continue;
        const data = (await res.json()) as ChatListItem[];
        setChatList(data);
        const target = data.find((c) => c.id === targetChatId);
        if (target?.title) {
          // Title generated, stop polling
          return;
        }
      } catch {
        // Network blip, keep trying
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
  // Encoded as "ollama:<modelId>" or "provider:<providerId>"
  useEffect(() => {
    const saved = localStorage.getItem(MODEL_STORAGE_KEY);
    if (!saved) return;
    if (saved.startsWith("provider:")) {
      setSelectedProviderId(saved.slice("provider:".length));
    } else if (saved.startsWith("ollama:")) {
      const id = saved.slice("ollama:".length);
      if (MODEL_OPTIONS.some((m) => m.id === id)) {
        setSelectedModel(id as ModelId);
      }
    } else if (MODEL_OPTIONS.some((m) => m.id === saved)) {
      // Backward compat with old format
      setSelectedModel(saved as ModelId);
    }
  }, []);

  // Persist model selection
  useEffect(() => {
    if (selectedProviderId) {
      localStorage.setItem(MODEL_STORAGE_KEY, `provider:${selectedProviderId}`);
    } else {
      localStorage.setItem(MODEL_STORAGE_KEY, `ollama:${selectedModel}`);
    }
  }, [selectedModel, selectedProviderId]);

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
  async function resolvePendingFile(file: File): Promise<string | null> {
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        setUploadError(err.error || `Failed to process ${file.name}`);
        return null;
      }
      const data = (await res.json()) as { content: string };
      return data.content;
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
        content = resolved;
      }

      const header = messageContent ? "\n\n" : "";
      messageContent += `${header}--- ${file.name} ---\n${content}\n--- end ${file.name} ---`;
    }

    if (!messageContent && images.length > 0) {
      messageContent = "What do you see in this image?";
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
            ? { providerId: selectedProviderId }
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
            onSelectOllama={handleOllamaSelect}
            onSelectProvider={(id) => setSelectedProviderId(id)}
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
            messages.map((msg, i) => <MessageBubble key={i} message={msg} />)
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

          <div className="relative">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.txt,.md,.json,.csv,.yaml,.yml,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.c,.cpp,.cs,.php,.swift,.sh,.sql,.html,.css"
              onChange={handleFileInputChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isStreaming}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Attach file"
            >
              <PaperclipIcon />
            </button>
            {(() => {
              const sel = customProviders.find((p) => p.id === selectedProviderId);
              // Show for Anthropic (native tool) and for local Ollama
              // (we proxy via Brave). OpenAI not wired yet.
              const isLocal = !selectedProviderId; // built-in local model
              const isAnthropic = sel?.type === "anthropic";
              const isOllamaCustom = sel?.type === "ollama";
              const supportsWebSearch = isAnthropic || isLocal || isOllamaCustom;
              if (!supportsWebSearch) return null;
              const isThirdParty = isLocal || isOllamaCustom;
              return (
                <div className="absolute left-11 top-1/2 -translate-y-1/2 group">
                  <button
                    type="button"
                    onClick={() => {
                      if (!webSearch) {
                        // Turning ON. For local providers, show the privacy
                        // warning the first time only.
                        if (isThirdParty) {
                          const acknowledged = localStorage.getItem(
                            "recallmem.webSearchAcknowledged"
                          );
                          if (!acknowledged) {
                            setShowWebSearchWarning(true);
                            return;
                          }
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
                      ? isThirdParty
                        ? "Web search on - queries go to Brave"
                        : "Web search on - Claude can browse the web"
                      : isThirdParty
                        ? "Web search off - click to enable (uses Brave)"
                        : "Web search off - click to let Claude browse the web"}
                  </span>
                </div>
              );
            })()}
            {/* Thinking toggle — disabled for now. With long chat contexts,
                thinking mode can cause Ollama to spend minutes reasoning
                before producing any visible tokens, which jams the single-
                request queue and blocks all subsequent requests. Re-enable
                once we add: (1) a timeout on thinking requests, (2) context
                trimming for think mode, (3) streaming thinking tokens
                through the typewriter correctly. */}
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={noChatBackend ? "Set up a model first ↑" : "Ask me anything"}
              rows={1}
              disabled={noChatBackend}
              className={`w-full resize-none rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 ${
                (() => {
                  const sel = customProviders.find((p) => p.id === selectedProviderId);
                  const showsGlobe = sel?.type === "anthropic" || sel?.type === "ollama" || !selectedProviderId;
                  return showsGlobe ? "pl-20" : "pl-12";
                })()
              } pr-12 py-3 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-700 disabled:opacity-50`}
            />
            {isStreaming ? (
              <button
                type="button"
                onClick={stopStreaming}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-red-600 text-white flex items-center justify-center hover:bg-red-700 transition-colors"
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
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
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
  disabled,
}: {
  chat: ChatListItem;
  isActive: boolean;
  onClick: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
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

const MessageBubble = memo(function MessageBubble({ message }: { message: Message }) {
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
          <button
            onClick={copyToClipboard}
            className={`absolute top-2 right-2 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity ${
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

function ModelPicker({
  modelId,
  providerId,
  onSelectOllama,
  onSelectProvider,
  customProviders,
  disabled,
}: {
  modelId: ModelId;
  providerId: string | null;
  onSelectOllama: (id: ModelId) => void;
  onSelectProvider: (id: string) => void;
  customProviders: ProviderListItem[];
  disabled: boolean;
}) {
  // Encode current selection as a string for the <select>
  const value = providerId ? `provider:${providerId}` : `ollama:${modelId}`;

  function handleChange(v: string) {
    if (v === "__add_provider__") {
      window.location.href = "/providers";
      return;
    }
    if (v.startsWith("provider:")) {
      onSelectProvider(v.slice("provider:".length));
    } else if (v.startsWith("ollama:")) {
      onSelectOllama(v.slice("ollama:".length) as ModelId);
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
        {customProviders.length > 0 && (
          <optgroup label="Custom providers">
            {customProviders.map((p) => (
              <option key={p.id} value={`provider:${p.id}`}>
                {p.label}
              </option>
            ))}
          </optgroup>
        )}
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
