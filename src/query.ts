/**
 * Ask a question against a community's conversations.
 *
 * Run:  npm run query -- --tenant acme-gaming "When is the tournament?"
 */
import * as config from "./config.js";
import { answer } from "./answer.js";
import { ingest } from "./ingest.js";
import { InMemoryVectorStore } from "./store.js";
import { parseArgs } from "node:util";

export async function _load_or_build(): Promise<InMemoryVectorStore> {
  if (InMemoryVectorStore.exists()) {
    return InMemoryVectorStore.load();
  }
  return ingest();
}

export async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { tenant: { type: "string" } },
  });

  const question = positionals[0];
  const tenant = values.tenant;
  if (!question || !tenant) {
    console.error('Usage: npm run query -- --tenant <id> "<question>"');
    process.exit(1);
  }

  const store = await _load_or_build();
  const result = await answer(question, tenant, store);

  console.log(`[${config.PROVIDER.toUpperCase()}] tenant=${tenant}`);
  console.log(`Q: ${question}\n`);
  console.log(result.answer);
  if (result.citations.length > 0) {
    console.log("\nCitations:");
    for (const c of result.citations) {
      console.log(`  - ${c.chunk} (#${c.channel}): messages ${c.messages.join(", ")}`);
    }
  }
  console.log("\nRetrieval (chunk, score):");
  for (const [cid, score] of result.retrieved) {
    console.log(`  ${score.toFixed(6)}  ${cid}`);
  }
}

if (process.argv[1] === import.meta.filename) {
  await main();
}
