import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Force MOCK mode for ALL tests so the suite is hermetic: deterministic,
    // offline, and zero API cost — even though .env may hold a real provider key.
    // `env` values are applied to process.env before any test module is imported,
    // so config.ts resolves PROVIDER="mock" at import time.
    env: { RAG_MOCK: "1" },
  },
});
