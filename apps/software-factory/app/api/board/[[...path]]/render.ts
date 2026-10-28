import type { RenderInput } from "@vercel/board/sync";
import { STATE_EMOJI } from "./inthread.ts";

/**
 * Slack's rendering: a PR root is one line, its state's emoji and a link titled with
 * the PR (`:pr-merged: [#67 Version Packages](…) · github-actions[bot]`), edited as its
 * state changes. A factory PR labeled with its `owner` shows them instead of the bot
 * (`· for <@U0456>`). A factory PR's message in its source thread (a reply labeled with
 * `pr.thread`) is the same line without a name: it's in the thread of the person it's for.
 * Everything else keeps the board's default.
 */
export function renderForSlack({ message, author, mentionOf, label }: RenderInput): string {
  const pr = /^PR #(\d+): (.+)\n(https:\/\/\S+)$/.exec(message.text);
  const emoji = STATE_EMOJI[message.labels.state ?? ""];
  const card = message.re !== null && !!message.labels["pr.thread"];
  if ((message.re !== null && !card) || !message.labels.pr || !pr || !emoji) {
    return `**${label}**: ${message.text}`;
  }
  const line = `:${emoji}: [${`#${pr[1]} ${pr[2]}`.replace(/[[\]]/g, "\\$&")}](${pr[3]})`;
  if (card) return line;
  const owner = message.labels.owner ? (mentionOf(message.labels.owner) ?? message.labels["owner.name"]) : undefined;
  return `${line} · ${owner ? `for ${owner}` : (mentionOf(message.by.actor) ?? author?.name ?? label)}`;
}
