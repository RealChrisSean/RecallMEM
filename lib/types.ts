// Core types for RecallMEM

export type ModelMode = "standard" | "unrestricted";

export interface ChatRow {
  id: string;
  user_id: string;
  title: string | null;
  transcript: string | null;
  message_count: number;
  model_mode: ModelMode;
  is_pinned: boolean;
  created_at: Date;
  updated_at: Date;
  // Set to whatever model + provider was last used for this chat. NULL
  // means "use defaults". Read by the post-chat finalize pipeline so
  // fact extraction uses the same LLM the user was actually chatting with.
  model: string | null;
  provider_id: string | null;
}

export interface UserFactRow {
  id: string;
  user_id: string;
  fact_text: string;
  category: string;
  source_chat_id: string | null;
  is_active: boolean;
  superseded_by: string | null;
  created_at: Date;
  valid_from: Date;
  valid_to: Date | null;
}

export interface UserProfileRow {
  user_id: string;
  profile_summary: string | null;
  cached_context: string | null;
  custom_instructions: string | null;
  updated_at: Date;
}

export interface TranscriptChunkRow {
  id: string;
  user_id: string;
  chat_id: string;
  chunk_text: string;
  chunk_index: number;
  embedding: number[] | null;
  created_at: Date;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
  images?: string[]; // base64-encoded image data (for vision-capable models)
}

export interface AttachedFile {
  name: string;
  type: "image" | "text" | "pdf";
  size: number;
  // For images: base64 data URL (set immediately for preview).
  // For text/pdf: undefined until submit, then populated with extracted text.
  content?: string;
}
