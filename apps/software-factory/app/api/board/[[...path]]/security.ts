import type { Watcher } from "vboard";
import type { tellPi } from "./agent";

/** Long enough for deepsec at its maximum thinking on a PR's diff, short of the sandbox's idle timeout. */
const DEEPSEC_TIMEOUT = "30m";

/**
 * A person's :security: reaction on a PR thread's root (from Slack) has Pi run deepsec on the
 * PR's diff and report back, reacting :secure: when it comes out clean. Anyone in the channel
 * can ask, the same rule as :shipit:. On a thread that isn't a PR, the watcher says so itself.
 */
export function security(options: { tellPi: typeof tellPi }): Watcher {
  return {
    // Not `--label pr`: a reaction on a non-PR thread gets an answer too.
    tail: "dev",
    run: async ({ event, board }) => {
      const root = event.message;
      if (
        event.type !== "reaction.added" ||
        event.payload.emoji !== "security" ||
        event.payload.from !== "slack" ||
        !event.payload.by.principal.startsWith("slack:user:") ||
        root?.re !== null
      ) return;
      const pr = root.labels.pr;
      const number = pr?.match(/^basehub-ai\/vboard#([1-9]\d*)$/)?.[1];
      if (!number) {
        await board.reply(root.id, "`:security:` works on PR threads: react on a basehub-ai/vboard pull request's thread to have Pi run a deepsec review of its diff.");
        return;
      }
      const requester = event.actor?.handle ?? event.payload.by.actor;
      await options.tellPi({
        task: "review",
        thread: root.id,
        key: `security-${event.index}`,
        message: [
          `${requester} (${event.payload.by.actor}) reacted with :security: to request a deepsec security review of ${pr} in board thread #${root.id}.`,
          `1. Check out the PR (gh pr checkout ${number} in your clone of basehub-ai/vboard), and git fetch origin so its base branch is current. Install Claude Code if it's missing (command -v claude || npm i -g @anthropic-ai/claude-code); deepsec uses it as its agent.`,
          `2. From the repo root, run: timeout ${DEEPSEC_TIMEOUT} env CLAUDE_CODE_EXECUTABLE=claude npx -y deepsec process --diff origin/<base> --comment-out deepsec.md > deepsec.log 2>&1, where <base> is the PR's base branch (gh pr view ${number} --json baseRefName). Note its exit code.`,
          `3. Exit 0 (no new findings): reply that deepsec found nothing, attach deepsec.log, and react on the root with vb react ${root.id} secure.`,
          "   Exit 1 (findings): reply with a short line per finding (file, issue, severity), attach deepsec.md, and don't react :secure:.",
          "   Any other exit (including 124, the timeout): the run failed. Say why, from deepsec.log, and don't react :secure:.",
          "Mention the requester in your reply. Don't change the PR's code for this unless someone asks.",
        ].join("\n"),
      });
    },
  };
}
