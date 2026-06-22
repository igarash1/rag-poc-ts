/**
 * Tests for conversation segmentation (buildChunks).
 *
 * The interesting behavior is the flush rule: messages group by (tenant, channel)
 * within a time-gap, BUT a reply stays attached to the conversation it answers
 * even when the gap would otherwise split it off. Channel/tenant remain hard
 * boundaries — a reply only relaxes the time gap, never the channel.
 */
import { describe, expect, it } from "vitest";

import { buildChunks } from "./segment.js";
import { SEGMENT_GAP_MINUTES } from "./config.js";
import type { Message } from "./types.js";

const BASE = "2024-01-01T00:00:00.000Z";

/** Minutes after BASE as an ISO timestamp. */
function at(min: number): string {
  return new Date(Date.parse(BASE) + min * 60_000).toISOString();
}

function msg(over: Partial<Message> & Pick<Message, "id">): Message {
  return {
    tenant: "t1",
    channel: "general",
    author: "alice",
    ts: BASE,
    content: "hello",
    replyTo: null,
    ...over,
  };
}

const farApart = SEGMENT_GAP_MINUTES + 30; // comfortably beyond the gap

describe("buildChunks segmentation", () => {
  it("splits messages separated by more than the time gap", () => {
    const chunks = buildChunks([
      msg({ id: "a", ts: at(0) }),
      msg({ id: "b", ts: at(farApart) }), // no reply → gap wins
    ]);
    expect(chunks).toHaveLength(2);
    expect(chunks.map((c) => c.messageIds)).toEqual([["a"], ["b"]]);
  });

  it("keeps a reply attached past the gap when its parent is in the open segment", () => {
    const chunks = buildChunks([
      msg({ id: "a", ts: at(0) }),
      msg({ id: "b", ts: at(farApart), replyTo: "a" }), // reply relaxes the gap
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.messageIds).toEqual(["a", "b"]);
  });

  it("does not link a reply across channels (channel stays a hard boundary)", () => {
    const chunks = buildChunks([
      msg({ id: "a", channel: "general", ts: at(0) }),
      msg({ id: "b", channel: "support", ts: at(1), replyTo: "a" }),
    ]);
    expect(chunks).toHaveLength(2);
  });
});
