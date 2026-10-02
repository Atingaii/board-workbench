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
import { tellPi } from "./agent";

// The software factory: vboard running on its own repo and BaseHub's Slack. Locally
// there's no VERCEL_ENV, so the log is SQLite at .a2/dev.db.
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
  },
  watch: {
    // Every firehose thread (Slack and GitHub issues) gets a kind, judged from all of it,
    // so a chat that turns into a bug report becomes kind=bug. Bugs get 🐛 in Slack too.
    triage: {
      tail: "firehose",
      run: async ({ event, board }) => {
        const message = event.message;
        if (event.type !== "message.posted" || !message || !byPerson(message)) {
          return;
        }
        const thread = await board.thread(message.re ?? message.id);
        const { answers } = await evaluate({
          model: "typesafe-ai/jev",
          state: [thread.message, ...thread.replies].map((m) => ({
            from: m.author?.name ?? m.by.actor,
            text: m.text,
          })),
          questions: {
            kind: {
              type: "choice",
              instructions:
                "A conversation with the team that builds vboard, a message board library and CLI. What is it, as a whole?",
              criteria: {
                bug: "Something in vboard is broken or behaves wrongly",
                feature: "A request for something vboard doesn't do yet",
                question: "Someone asking how something works",
                noise: "Chatter, an announcement, or nothing to act on",
              },
            },
          },
        });
        const kind = answers.kind.choice;
        if (thread.message.labels.kind === kind) {
          return;
        }
        await board.label(thread.message.id, { set: { kind } });
        if (kind === "bug") {
          await board.react(thread.message.id, "bug");
        }
      },
    },
    // A thread triage calls a bug goes to Pi, which reproduces it and opens a PR, or closes it.
    investigate: {
      tail: "firehose --label kind=bug",
      run: async ({ event }) => {
        const message = event.message;
        const set = (event.payload as { set?: Record<string, string> }).set;
        if (
          event.type !== "labels.changed" ||
          set?.kind !== "bug" ||
          !message ||
          message.re !== null
        ) {
          return;
        }
        await tellPi({
          thread: message.id,
          key: "report",
          message: `There's a bug report in board thread #${message.id}.`,
        });
      },
    },
    // Someone replied in a bug thread: Pi hears there's news, and reads it itself.
    "follow-up": {
      tail: "firehose --label kind=bug",
      run: async ({ event }) => {
        const message = event.message;
        if (
          event.type !== "message.posted" ||
          !message ||
          message.re === null ||
          !byPerson(message)
        ) {
          return;
        }
        await tellPi({
          thread: message.re,
          key: `news-${message.id}`,
          message: `There's new activity in board thread #${message.re}.`,
        });
      },
    },
  },
});

/** Written by a person, here or on a platform: not by Pi (a profile) or a watcher. */
function byPerson(message: { by: { actor: string; profile: string | null } }) {
  return message.by.profile === null && !message.by.actor.startsWith("vboard:");
}
