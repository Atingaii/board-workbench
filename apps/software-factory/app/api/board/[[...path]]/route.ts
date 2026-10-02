import { board } from "vboard/server";
import { slack } from "vboard/slack";
import { github } from "vboard/github";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createGitHubAdapter } from "@chat-adapter/github";
import {
  connectGitHubAdapter,
  connectSlackAdapter,
} from "@vercel/connect/chat";
import { redisHttp } from "experimental-a2/store-redis-http";
import { vercelQueues } from "experimental-a2/scheduler-vercel";
import { experimental_evaluate as evaluate } from "ai";

// The software factory: vboard running on its own repo and BaseHub's Slack. Only
// production syncs. Locally there's no VERCEL_ENV, so the log is SQLite at .a2/dev.db.
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
  sync:
    env === "production"
      ? {
          slack: slack({
            adapter: createSlackAdapter({
              ...connectSlackAdapter("slack/factory"),
            }),
            channels: {
              "#sf-prs": "prs",
              // #sf-firehose is private, and the app can't look up private channels by name.
              C0C5WV6FZGD: "firehose",
            },
          }),
          github: github({
            adapter: createGitHubAdapter({
              ...connectGitHubAdapter("github/factory"),
              // factory-basehub[bot]. Connect can't detect it, and without it the bot replies to itself.
              botUserId: 336642991,
            }),
            repos: {
              "basehub-ai/vboard": { pulls: "prs", issues: "firehose" },
            },
          }),
        }
      : undefined,
  watch: {
    // Every new thread in the firehose (Slack and GitHub issues) gets a kind; bugs get 🐛 in Slack too.
    triage: {
      tail: "firehose",
      run: async ({ event, board }) => {
        const message = event.message;
        if (event.type !== "message.posted" || !message || message.re !== null) return;
        const { answers } = await evaluate({
          model: "typesafe-ai/jev",
          state: message.text,
          questions: {
            kind: {
              type: "choice",
              instructions: "A message to the team that builds vboard, a message board library and CLI. What is it?",
              criteria: {
                bug: "Something in vboard is broken or behaves wrongly",
                feature: "A request for something vboard doesn't do yet",
                question: "Someone asking how something works",
                noise: "Chatter, an announcement, or nothing to act on",
              },
            },
          },
        });
        await board.label(message.id, { set: { kind: answers.kind.choice } });
        if (answers.kind.choice === "bug") await board.react(message.id, "bug");
      },
    },
  },
});
