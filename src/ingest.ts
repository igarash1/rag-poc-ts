/**
 * Ingest: messages -> conversation chunks -> embeddings -> persisted index.
 *
 * Run:  npm run ingest
 */
import * as config from "./config.js";
import { embed_texts } from "./embed.js";
import { build_chunks, load_messages } from "./segment.js";
import { InMemoryVectorStore } from "./store.js";

export async function ingest(): Promise<InMemoryVectorStore> {
  const messages = load_messages();
  const chunks = build_chunks(messages);

  // Batch-embed all chunk texts (one API call in real mode).
  const vectors = await embed_texts(chunks.map((c) => c.text));
  chunks.forEach((c, i) => {
    c.embedding = vectors[i]!; // zip(chunks, vectors) → index; ! drops the number[]|undefined
  });

  const store = new InMemoryVectorStore();
  store.add(chunks);
  store.save();
  return store;
}

if (process.argv[1] === import.meta.filename) {
  await ingest(); // top-level await is fine in ESM
  const n = load_messages().length;
  console.log(
    `[${config.PROVIDER.toUpperCase()}] Ingested ${n} messages -> index at ${config.INDEX_FILE}`,
  );
}
