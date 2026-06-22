/**
 * Turn a flat message log into retrievable conversation chunks.
 *
 * Design decision (interview talking point): we group messages into conversation
 * segments by (tenant, channel) + a time-gap rule, then render each segment as
 * speaker-attributed lines. This preserves *who said what, when* and keeps a
 * question together with its answer — the thing that makes conversation RAG work.
 * Message-level chunks would shred that context.
 */

import * as config from "./config.js";
import type { Chunk, Message } from "./types.js";
import { readFileSync } from "node:fs";

/** The on-disk JSON shape (snake_case). Mapped to the camelCase `Message` below. */
interface RawMessage {
  id: string;
  tenant: string;
  channel: string;
  author: string;
  ts: string;
  content: string;
  reply_to: string | null;
}

export function load_messages(path?: string): Message[] {
  path = path ?? config.DATA_FILE;
  if (!path) {
    throw new Error("DATA_FILE environment variable is not set.");
  }
  const raw = JSON.parse(readFileSync(path, "utf-8")) as RawMessage[];
  return raw.map(
    (m): Message => ({
      id: m.id,
      tenant: m.tenant,
      channel: m.channel,
      author: m.author,
      ts: m.ts,
      content: m.content,
      replyTo: m.reply_to ?? null, // JSON is snake_case → map to camelCase
    }),
  );
}

function parse_ts(ts: string): Date {
  // ISO-8601 (including a trailing 'Z') parses natively on Node >= 20.
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid timestamp: ${ts}`);
  }
  return d;
}

export function build_chunks(messages: Message[]): Chunk[] {
  // Stable ordering within each (tenant, channel) timeline.
  // Copy first — Array.sort mutates in place, and we don't own the caller's array.
  messages = [...messages].sort((a, b) => {
    const a_ts = parse_ts(a.ts);
    const b_ts = parse_ts(b.ts);
    if (a.tenant !== b.tenant) return a.tenant.localeCompare(b.tenant);
    if (a.channel !== b.channel) return a.channel.localeCompare(b.channel);
    return a_ts.getTime() - b_ts.getTime();
  });

  const chunks: Chunk[] = [];
  let cur: Message[] = [];
  const gap = 1000 * 60 * config.SEGMENT_GAP_MINUTES;

  function flush() {
    if (cur.length === 0) return;
    const first = cur[0]!;
    const lines = cur.map((m) => `${m.author} (${m.ts}): ${m.content}`);
    chunks.push({
      id: `${first.tenant}:${first.channel}:${chunks.length}`,
      tenant: first.tenant,
      channel: first.channel,
      text: lines.join("\n"),
      messageIds: cur.map((m) => m.id),
    });
    cur = [];
  }

  for (const m of messages) {
    if (cur.length > 0) {
      const prev = cur[cur.length - 1]!;
      const same_thread = prev.tenant === m.tenant && prev.channel === m.channel;
      const within_gap = parse_ts(m.ts).getTime() - parse_ts(prev.ts).getTime() <= gap;
      if (!(same_thread && within_gap)) {
        flush();
      }
    }
    cur.push(m);
  }
  flush();
  return chunks;
}
