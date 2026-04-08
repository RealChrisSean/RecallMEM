"use client";

import { useState, useRef, useEffect, FormEvent, DragEvent, ChangeEvent } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ModelMode, Message, AttachedFile } from "@/lib/types";
import { MODEL_OPTIONS, type ModelId } from "@/lib/llm-config";
import { AppFooter } from "@/components/AppFooter";
import { Logo } from "@/components/Logo";

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
      setMessages(data.messages);
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

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
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
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Request failed: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantContent = "";

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
            const chunk = JSON.parse(data) as { delta?: string; done?: boolean; error?: string; chatId?: string };
            if (chunk.chatId) {
              setChatId(chunk.chatId);
              continue;
            }
            if (chunk.error) {
              assistantContent = `Error: ${chunk.error}`;
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "assistant", content: assistantContent };
                return updated;
              });
              continue;
            }
            if (chunk.delta) {
              assistantContent += chunk.delta;
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "assistant", content: assistantContent };
                return updated;
              });
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: "assistant", content: `Error: ${message}` };
        return updated;
      });
    } finally {
      setIsStreaming(false);
      refreshChatList();
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
      <div className="flex flex-col flex-1 min-w-0">
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
            onSelectOllama={(id) => {
              setSelectedModel(id);
              setSelectedProviderId(null);
            }}
            onSelectProvider={(id) => setSelectedProviderId(id)}
            customProviders={customProviders}
            disabled={isStreaming || isFinalizing}
          />
          <Link
            href="/providers"
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-700 dark:text-zinc-300"
          >
            Providers
          </Link>
          <Link
            href="/rules"
            className="px-3 py-1.5 text-sm font-mono font-medium rounded-md border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-700 dark:text-zinc-300"
          >
            RULES.md
          </Link>
          <Link
            href="/memory"
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-700 dark:text-zinc-300"
          >
            Memory
          </Link>
          {/* Unrestricted mode hidden until vMLX + abliterated Gemma 4 is set up. See TODO.md */}
          <button
            onClick={newChat}
            disabled={isStreaming || isFinalizing || messages.length === 0}
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-zinc-700 dark:text-zinc-300"
          >
            New chat
          </button>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
          {messages.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-zinc-500 dark:text-zinc-400 text-sm">
                Start a conversation. Nothing leaves your machine.
              </p>
            </div>
          ) : (
            messages.map((msg, i) => <MessageBubble key={i} message={msg} />)
          )}
        </div>
      </div>

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
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message RecallMEM..."
              rows={1}
              disabled={isStreaming}
              className="w-full resize-none rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 pl-12 pr-12 py-3 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-700 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={(!input.trim() && attachedFiles.length === 0) || isStreaming}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
            >
              <ArrowUpIcon />
            </button>
          </div>
        </form>
      </div>

      </div>
      {/* /Main column */}

      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-zinc-900/40 dark:bg-zinc-950/60 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="bg-white dark:bg-zinc-900 border-2 border-dashed border-zinc-400 dark:border-zinc-600 rounded-2xl px-12 py-8 text-center">
            <div className="text-zinc-700 dark:text-zinc-200 font-medium">Drop files to attach</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              Images, PDFs, text, code
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
  if (!open) return null;

  // Split into pinned and unpinned, then group unpinned by date
  const pinned = chats.filter((c) => c.is_pinned);
  const unpinned = chats.filter((c) => !c.is_pinned);
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

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
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
        {!message.content ? (
          <span className="text-zinc-400 dark:text-zinc-600">...</span>
        ) : isUser ? (
          message.content
        ) : (
          <MarkdownContent content={message.content} />
        )}
      </div>
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose prose-sm prose-zinc dark:prose-invert max-w-none prose-p:my-2 prose-headings:mt-4 prose-headings:mb-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-pre:my-2 prose-code:before:content-none prose-code:after:content-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
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
