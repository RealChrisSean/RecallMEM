import "server-only";

/**
 * Langfuse client for observability.
 *
 * **Optional peer dependency.** The `langfuse` package is NOT installed by
 * default. Users who don't care about traces never download it. Users who
 * want it run `npm install langfuse` themselves and set the env vars below.
 * If the package is missing OR the env vars are unset, every call site
 * no-ops at zero cost.
 *
 * **Self-hosted by default.** The point of pairing this with RecallMEM is
 * that traces don't have to leave your machine. Run Langfuse locally via
 * Docker (https://langfuse.com/docs/deployment/self-host) and point
 * `LANGFUSE_BASEURL` at `http://localhost:3000`.
 *
 * Required env vars to enable:
 *   LANGFUSE_PUBLIC_KEY  - public key from your Langfuse project
 *   LANGFUSE_SECRET_KEY  - secret key from your Langfuse project
 *   LANGFUSE_BASEURL     - optional, defaults to https://cloud.langfuse.com
 *
 * **This is a developer-only debugging tool.** It's not meant for end users
 * of RecallMEM. Trace payloads include the actual user message content, so
 * never enable this on a machine where you wouldn't be comfortable shipping
 * conversation contents to your Langfuse instance.
 */

// We type as `unknown`-like minimal shape because the real `langfuse` types
// are only available when the optional package is installed. Call sites
// only use the methods listed here.
interface LangfuseLike {
  trace: (opts: Record<string, unknown>) => LangfuseTraceLike;
  flushAsync: () => Promise<void>;
}
interface LangfuseTraceLike {
  span: (opts: Record<string, unknown>) => { end: (opts?: Record<string, unknown>) => void };
  generation: (opts: Record<string, unknown>) => {
    end: (opts?: Record<string, unknown>) => void;
  };
  update: (opts: Record<string, unknown>) => void;
}

let cached: LangfuseLike | null | undefined;
let initPromise: Promise<LangfuseLike | null> | null = null;

async function init(): Promise<LangfuseLike | null> {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) return null;
  try {
    // Dynamic import so the package is only loaded when keys are set.
    // If the package isn't installed at all, this throws and we no-op.
    // The literal string is wrapped to bypass TS module resolution since
    // langfuse is an optional peer dep that may not exist at build time.
    const modName = "langfuse";
    const mod = (await import(/* @vite-ignore */ /* webpackIgnore: true */ modName)) as unknown as {
      Langfuse: new (opts: Record<string, unknown>) => LangfuseLike;
    };
    return new mod.Langfuse({
      publicKey,
      secretKey,
      baseUrl: process.env.LANGFUSE_BASEURL || "https://cloud.langfuse.com",
      flushAt: 1,
    });
  } catch (err) {
    // Package not installed or failed to load. Silently disable.
    if (process.env.LANGFUSE_DEBUG) {
      console.warn("[langfuse] disabled:", err instanceof Error ? err.message : err);
    }
    return null;
  }
}

// Synchronous accessor that returns whatever has been initialized so far.
// Returns null until the first await of getLangfuseAsync() resolves, which
// is fine because the integration is fire-and-forget anyway.
export function getLangfuse(): LangfuseLike | null {
  if (cached !== undefined) return cached;
  // Kick off init in the background but return null for this synchronous
  // call. The next call (after init resolves) will get the real client.
  if (!initPromise) {
    initPromise = init().then((client) => {
      cached = client;
      return client;
    });
  }
  return null;
}
