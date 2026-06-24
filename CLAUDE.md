# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status: Python → TypeScript port (COMPLETE)

This repo is a conversation-RAG learning project, originally Python, now fully rewritten to
TypeScript. All `src/*.ts` modules are idiomatic TS; the MOCK-mode pipeline is
verified end-to-end against the original Python's eval baseline (recall@4 5/5,
refusal 2/2, 100% overall, reproducible via `npm run eval`).

- The original Python is recoverable from git history (`git log`, then
  `git show <commit>:src/<name>.py`) — the `.py` files were removed when the port
  landed.
- **Verify behavior against metrics, not numbers.** The MOCK embedder uses a
  deterministic JS hash (FNV-1a), so its cosine _scores_ differ from Python's
  (Python's `hash()` is salted per process) — but the eval _metrics_ match:
  recall@4 5/5, refusal 2/2, 100% overall via `npm run eval`. Don't chase decimals.

## Commands

```bash
npm run typecheck                  # tsc --noEmit (full project; must be 0 errors)
npm test                           # vitest run — all tests once
npm run test:watch                 # vitest watch
npx vitest run src/store.test.ts   # a single test file
npx vitest run -t "tenant"         # tests matching a name substring
npm run lint                       # eslint (or npx eslint src/<file>.ts for one)
npm run format                     # prettier --write .
```

Pipeline scripts (MOCK mode runs offline & free; a provider key in `.env`
switches to real Gemini/OpenAI — prefix `RAG_MOCK=1` to force MOCK):

```bash
npm run ingest                                             # build the index → rag-index.json
npm run query -- "When is the tournament?" --tenant acme-gaming
npm run eval                                               # metrics vs the golden set
```

The MOCK eval should always report recall@4 5/5, refusal 2/2, 100% overall.

`query`/`eval` auto-build the index if `rag-index.json` is missing, else they load
it. **Switching providers changes the embedding space/dimension**, so a `rag-index.json`
built under one provider is incompatible with another — `rm rag-index.json` (or
re-run `ingest`) when you switch between mock / Gemini / OpenAI.

## Architecture (the big picture)

A retrieval-augmented Q&A pipeline over multi-tenant community chat. Five stages,
each its own module (`segment → embed → store → retrieve → answer`), wired by
`ingest` (offline index build) and `query` (online ask). Data flows:

`messages.json → segment (group by tenant+channel+time-gap into conversation chunks) → embed (vectors) → store (tenant-aware cosine index) → retrieve (top-k within tenant + hybrid lexical re-rank) → answer (gate by relevance threshold: refuse or LLM-answer with citations)`

Cross-cutting concepts that span multiple files (read `README.md` for the "why"):

- **Provider-agnostic + MOCK mode** (`config.ts`): provider is auto-detected from
  which API key is present (Gemini → OpenAI → else **mock**). MOCK uses
  deterministic fake embeddings + templated answers, so the whole pipeline runs
  offline with zero API cost. Provider SDKs are loaded with dynamic `import()`
  and are `optionalDependencies` — absent SDKs never break MOCK mode.
- **Tenant isolation** is enforced in the vector store's `search` (`store.ts`):
  other tenants are masked out before top-k, so one community can never surface
  another's data. There is a cross-tenant case in the eval set.
- **Refuse, don't hallucinate** (`answer.ts`): if no chunk clears
  `RETRIEVAL_MIN_SCORE`, return "I don't know." The threshold is
  embedding-space-dependent and **calibrated per provider** — that is what
  `eval.ts` measures (`config.ts` holds the per-provider defaults).
- **`VectorStore` is an interface** (`store.ts`); `InMemoryVectorStore` is a
  transparent brute-force implementation — the seam where pgvector/Chroma/Pinecone
  would drop in.

## Conventions

The clearest references are `src/types.ts`, `src/config.ts`, `src/store.ts`, and
`src/store.test.ts` — their file headers contain explicit Python → TS notes.
Follow these conventions for any new or changed code:

- **ESM with NodeNext**: relative imports MUST carry a `.js` extension even though
  the source is `.ts` — `import { tokenize } from "./text.js"`.
- **camelCase domain types, snake_case only at the JSON boundary**: the on-disk
  JSON uses snake_case (`reply_to`, `expected_message_ids`); map to camelCase when
  reading (only in `segment.ts`'s message load and `eval.ts`'s golden load).
  Everything in-memory is camelCase.
- **Hand-written vector math** (no numpy): see `l2normalize` / `dot` / top-k in
  `store.ts`.
- **The MOCK embedder must NOT reproduce Python's numbers.** Python's `hash()` is
  salted per process, so its scores aren't reproducible even across Python runs.
  Use a deterministic JS hash (e.g. FNV-1a). **Verify against the metrics, not the
  decimals**: recall@4, refusal accuracy, overall accuracy (100% in MOCK via
  `npm run eval`).
- `strict` is on plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
  — handle the `| undefined` the compiler surfaces rather than asserting it away.

### Extending or changing a module

1. Cross-check behavior against the Python original in git history if relevant.
2. Make the change idiomatically (see conventions above).
3. `npm run typecheck` (must be 0) and add/extend a `*.test.ts` for real logic.
4. Re-run `npm run eval` (MOCK) — it must still hit 100% (recall@4 5/5, refusal 2/2).
