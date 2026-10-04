import { board, type Watcher } from "vboard/server";
import { slack } from "vboard/slack";
import { createSlackAdapter } from "@chat-adapter/slack";
import { connectSlackAdapter } from "@vercel/connect/chat";
import { redisHttp } from "experimental-a2/store-redis-http";
import { vercelQueues } from "experimental-a2/scheduler-vercel";
import { generateText, Output } from "ai";
import { z } from "zod";
import { startV0 } from "./v0";

// The v0 feedback bot, on Vercel's Slack: people post v0 feedback in #feedback-v0-vboard.
// Each new thread gets :ack:; the ones worth addressing get a v0 chat, a :v0:, and a
// post in #feedback-v0-prs. Locally there's no VERCEL_ENV, so the log is SQLite at .a2/dev.db.
const env = process.env.VERCEL_ENV;

// SSE streams close just before this, and clients reconnect from their cursor.
export const maxDuration = 300;

export const { GET, POST, scheduler } = board({
  store: env
    ? redisHttp({
        url: process.env.KV_REST_API_URL!,
        token: process.env.KV_REST_API_TOKEN!,
        // One Redis serves every environment: a preview never touches production's log.
        keyPrefix: env === "production" ? "vboard" : `vboard:${env}`,
      })
    : undefined,
  scheduler: vercelQueues({ topic: "vboard" }),
  sync: {
    slack: slack({
      adapter: createSlackAdapter({ ...connectSlackAdapter("slack/vboard") }),
      // Both are private, and the app can't look up private channels by name.
      channels: {
        C0C6FNTCRC6: "feedback", // #feedback-v0-vboard
        C0C6CCVJ48N: "v0-prs", // #feedback-v0-prs
      },
    }),
  },
  watch: {
    triage: { tail: "feedback", run: triage },
    report: { tail: "feedback --label v0state=done", run: report },
  },
});

/** Acks a new thread, decides whether it's worth addressing, and hands the ones that are to v0. */
async function triage({ event, board }: Parameters<Watcher["run"]>[0]) {
  const message = event.message;
  if (event.type !== "message.posted" || !message || message.re !== null) return;
  await board.react(message.id, "ack");
  const { output: verdict } = await generateText({
    model: "openai/gpt-6-luna",
    output: Output.object({
      schema: z.object({
        kind: z.enum(["bug", "feature", "feedback", "noise"]),
        worth: z.boolean().describe("Whether v0 should try to fix or build this now"),
        reason: z.string().describe("One short sentence"),
      }),
    }),
    system: [
      "You triage feedback about v0, Vercel's AI app builder.",
      "kind — bug: something is broken or behaves wrongly. feature: a request for something v0 doesn't do yet, or a concrete improvement. feedback: an opinion, praise or complaint, with nothing specific to act on. noise: chatter or nothing to act on.",
      "worth is true only for a bug or feature that is specific enough to act on and small enough for a coding agent to attempt: a clear symptom or ask, not a vague wish or a strategy question.",
    ].join("\n"),
    prompt: message.text,
  });
  await board.label(message.id, { set: { kind: verdict.kind, worth: String(verdict.worth) } });
  if (!verdict.worth || (verdict.kind !== "bug" && verdict.kind !== "feature")) return;
  // A retried watcher sees the event as it was: check the thread as it is now.
  if ((await board.thread(message.id)).message.labels.v0) return;
  const chat = await startV0({ kind: verdict.kind, text: message.text, source: slackLink(message.origin?.thread) });
  await board.label(message.id, { set: { v0: chat.id } });
  await board.react(message.id, "v0");
  const firstLine = message.text.split("\n")[0]!.slice(0, 140);
  const announcement = await board.post("v0-prs", {
    text: `v0 is on a ${verdict.kind}: “${firstLine}”\n${verdict.reason}\n${chat.url}${message.origin ? `\nsource: ${slackLink(message.origin.thread)}` : ""}`,
    labels: { source: String(message.id), v0: chat.id, kind: verdict.kind },
  });
  await board.label(message.id, { set: { announcement: String(announcement.id) } });
}

/** v0 finished (labelled by /api/v0-hook): reply in the announcement's thread with what it did. */
async function report({ event, board }: Parameters<Watcher["run"]>[0]) {
  const message = event.message;
  const set = (event.payload as { set?: Record<string, string> }).set;
  if (event.type !== "labels.changed" || set?.v0state !== "done" || !message) return;
  // v0 can report a turn finished more than once; watchers run one at a time per
  // thread, so checking the thread as it is now keeps this to one reply.
  const { labels } = (await board.thread(message.id)).message;
  const announcement = Number(labels.announcement);
  if (!announcement || labels.reported) return;
  const { pr, owner, summary } = labels;
  const text = [
    pr ? `v0 opened a draft PR: ${pr}` : `v0 finished without a PR: https://v0.app/chat/${labels.v0}`,
    summary,
    owner ? `likely owner: ${owner}` : null,
  ].filter(Boolean).join("\n");
  await board.reply(announcement, text);
  await board.label(message.id, { set: { reported: "yes" } });
}

/** `slack:C0123:1727.1234` → a Slack permalink. */
function slackLink(target: string | undefined) {
  const [, channel, ts] = target?.split(":") ?? [];
  return channel && ts ? `https://vercel.slack.com/archives/${channel}/p${ts.replace(".", "")}` : null;
}
