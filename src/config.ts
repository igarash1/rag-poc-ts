/**
 * Central configuration. Reads .env; falls back to MOCK mode without a key.
 *
 * Python → TS notes:
 *   - `from dotenv import load_dotenv; load_dotenv()` → `import "dotenv/config"`,
 *     a side-effect import that populates `process.env` before anything reads it.
 *   - `os.getenv("X", "")` → `process.env.X ?? ""`. `process.env` values are
 *     `string | undefined`, so `?? ""` gives you Python's default-string behavior.
 *   - `pathlib.Path(__file__).resolve().parent.parent` has no `__file__` in ESM.
 *     The equivalent is `fileURLToPath(import.meta.url)` + `node:path`.
 */
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url)); // .../src
export const ROOT = path.resolve(HERE, ".."); // repo root

export const DATA_FILE = path.join(ROOT, "data", "sample_conversations.json");
export const GOLDEN_FILE = path.join(ROOT, "eval", "golden.json");
/**
 * Persisted vector index (created by ingest). The Python version used a numpy
 * `.npz` + a `.json` sidecar; the TS store writes a single self-contained JSON,
 * so we give it a distinct name to avoid clashing with any leftover Python index.
 */
export const INDEX_FILE = path.join(ROOT, "rag-index.json");

// --- Provider selection ---------------------------------------------------
// Provider-agnostic: pick Gemini or OpenAI by whichever key is present (override
// with RAG_PROVIDER=gemini|openai|mock). No key -> MOCK mode, so the whole
// pipeline still runs offline with deterministic fake embeddings.
const env = (key: string): string => (process.env[key] ?? "").trim();

export type Provider = "mock" | "gemini" | "openai";
const PROVIDERS: readonly Provider[] = ["mock", "gemini", "openai"];

export const OPENAI_API_KEY = env("OPENAI_API_KEY");
export const GOOGLE_API_KEY = env("GEMINI_API_KEY") || env("GOOGLE_API_KEY");

const forced = env("RAG_PROVIDER").toLowerCase();
if (forced && !(PROVIDERS as readonly string[]).includes(forced)) {
  throw new Error(
    `Invalid RAG_PROVIDER="${forced}" — expected one of: ${PROVIDERS.join(", ")}.`,
  );
}
export const PROVIDER: Provider = process.env.RAG_MOCK
  ? "mock"
  : forced
    ? (forced as Provider)
    : GOOGLE_API_KEY
      ? "gemini"
      : OPENAI_API_KEY
        ? "openai"
        : "mock";

export const MOCK = PROVIDER === "mock";

// Per-provider model defaults (override via CHAT_MODEL / EMBED_MODEL env).
export const CHAT_MODEL =
  env("CHAT_MODEL") || (PROVIDER === "gemini" ? "gemini-2.5-flash" : "gpt-4o-mini");
export const EMBED_MODEL =
  env("EMBED_MODEL") ||
  (PROVIDER === "gemini" ? "gemini-embedding-001" : "text-embedding-3-small");

export const EMBED_DIM = 1536; // only used by MOCK embeddings; real dims come from the provider

// Retrieval / answering knobs
export const TOP_K = 4;

// Refusal threshold: if the best retrieved score is below this, we say
// "I don't know" instead of hallucinating. The right value is
// EMBEDDING-SPACE-DEPENDENT, so it must be CALIBRATED per model on a labeled set
// (that is exactly what eval.ts measures). Each provider's embeddings have a
// different "floor", hence different values. NOTE: the TS mock uses a different
// hash than Python's, so if a real eval case dips below the mock floor,
// recalibrate THIS value for the TS mock rather than chasing Python's exact scores.
const DEFAULT_THRESHOLD: Record<Provider, number> = {
  mock: 0.18,
  gemini: 0.5,
  openai: 0.35,
};
export const RETRIEVAL_MIN_SCORE = Number(
  process.env.RETRIEVAL_MIN_SCORE ?? DEFAULT_THRESHOLD[PROVIDER],
);

// Conversation segmentation: messages in the same channel within this many
// minutes (or linked by replyTo) are grouped into one "conversation" chunk.
export const SEGMENT_GAP_MINUTES = 30;
