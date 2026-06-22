/**
 * Offline eval over a golden set. Retrieval-centric, so it costs nothing to
 * run (no LLM calls) and is deterministic in MOCK mode.
 *
 * Metrics:
 *   - recall@k    : for answerable questions, was an expected source message
 *                   inside the top-k retrieved chunks?
 *   - refusal acc : for unanswerable questions (incl. cross-tenant), did we
 *                   correctly refuse?
 *   - overall acc : both of the above combined.
 *
 * Faithfulness (does the generated answer only use retrieved facts?) is the
 * natural next layer — typically an LLM-as-judge pass — left as a production TODO.
 *
 * Run:  npm run eval
 */
import * as config from "./config.js";
import { _load_or_build } from "./query.js";
import { retrieve } from "./retrieve.js";
import { readFileSync } from "node:fs";

interface GoldenCase {
  question: string;
  tenant: string;
  answerable: boolean;
  expected_message_ids: string[]; // snake_case: matches the JSON (read-only boundary)
}

async function run(): Promise<void> {
  const store = await _load_or_build();
  const golden = JSON.parse(readFileSync(config.GOLDEN_FILE, "utf-8")) as GoldenCase[];

  let n_ans = 0;
  let n_ans_ok = 0;
  let n_unans = 0;
  let n_unans_ok = 0;

  console.log(
    `[${config.PROVIDER.toUpperCase()}] eval over ${golden.length} cases ` +
      `(k=${config.TOP_K}, refuse<${config.RETRIEVAL_MIN_SCORE})\n`,
  );
  console.log(
    `${"ok".padStart(2)}  ${"top".padStart(6)}  ${"refuse".padStart(6)}  tenant / question`,
  );
  console.log("-".repeat(72));

  for (const g of golden) {
    const hits = await retrieve(g.question, g.tenant, store, config.TOP_K);
    const top = hits[0]?.score ?? Number.NEGATIVE_INFINITY;
    const refused = hits.length === 0 || top < config.RETRIEVAL_MIN_SCORE;
    const retrieved_ids = new Set(hits.flatMap((h) => h.chunk.messageIds));

    let ok: boolean;
    if (g.answerable) {
      n_ans += 1;
      const hit = g.expected_message_ids.some((mid) => retrieved_ids.has(mid));
      ok = !refused && hit;
      if (ok) n_ans_ok += 1;
    } else {
      n_unans += 1;
      ok = refused;
      if (ok) n_unans_ok += 1;
    }

    const mark = (ok ? "OK" : "X").padStart(2);
    console.log(
      `${mark}  ${top.toFixed(3).padStart(6)}  ${String(refused).padStart(6)}  ` +
        `${g.tenant} / ${g.question.slice(0, 38)}`,
    );
  }

  console.log("-".repeat(72));
  const pct = (num: number, den: number): string => `${Math.round((100 * num) / den)}%`;
  if (n_ans > 0) {
    console.log(
      `recall@${config.TOP_K} (answerable):   ${n_ans_ok}/${n_ans} = ${pct(n_ans_ok, n_ans)}`,
    );
  }
  if (n_unans > 0) {
    console.log(
      `refusal acc (unanswerable): ${n_unans_ok}/${n_unans} = ${pct(n_unans_ok, n_unans)}`,
    );
  }
  const total_ok = n_ans_ok + n_unans_ok;
  const total = n_ans + n_unans;
  console.log(
    `overall accuracy:           ${total_ok}/${total} = ${pct(total_ok, total)}`,
  );
}

if (process.argv[1] === import.meta.filename) {
  await run();
}
