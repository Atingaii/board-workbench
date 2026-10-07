import type { slack } from "vboard/adapter-slack";

type RenderInput = Parameters<NonNullable<Parameters<typeof slack>[0]["render"]>>[0];

/** A PR's state as the workspace's PR emoji. */
const STATE_EMOJI: Record<string, string> = {
  open: ":pr:",
  draft: ":pr-draft:",
  merged: ":pr-merged:",
  closed: ":pr-closed:",
};

/**
 * Slack's rendering: a PR root is one line, its state's emoji and a link titled with
 * the PR (`:pr-merged: [#67 Version Packages](…) · github-actions[bot]`), edited as its
 * state changes. Everything else keeps the board's default.
 */
export function renderForSlack({ message, author, label }: RenderInput): string {
  const pr = /^PR #(\d+): (.+)\n(https:\/\/\S+)$/.exec(message.text);
  const emoji = STATE_EMOJI[message.labels.state ?? ""];
  if (message.re !== null || !message.labels.pr || !pr || !emoji) {
    return `**${label}**: ${message.text}`;
  }
  const text = `#${pr[1]} ${pr[2]}`.replace(/[[\]]/g, "\\$&");
  return `${emoji} [${text}](${pr[3]}) · ${author?.name ?? label}`;
}
