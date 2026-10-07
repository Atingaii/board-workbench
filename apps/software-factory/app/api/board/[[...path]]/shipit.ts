import type { Watcher } from "vboard";
import { getToken } from "@vercel/connect";
import type { tellPi } from "./agent";

/** Reactions that request a merge. Slack delivers :shipit: as `squirrel`. */
const MERGE_EMOJI = new Set(["shipit", "squirrel", "approved"]);

export function shipit(options: {
  tellPi: typeof tellPi;
  token?: () => Promise<string>;
  fetch?: typeof fetch;
}): Watcher {
  const request = options.fetch ?? globalThis.fetch;
  return {
    tail: "--label pr",
    run: async ({ event }) => {
      const root = event.message;
      if (
        event.type !== "reaction.added" ||
        !MERGE_EMOJI.has(event.payload.emoji) ||
        event.payload.from !== "slack" ||
        !event.payload.by.principal.startsWith("slack:user:") ||
        root?.re !== null
      ) return;
      const number = root.labels.pr?.match(/^basehub-ai\/vboard#([1-9]\d*)$/)?.[1];
      if (!number) return;
      try {
        const token = await (options.token?.() ?? getToken("github/vboard-factory", { subject: { type: "app" } }));
        const url = `https://api.github.com/repos/basehub-ai/vboard/pulls/${number}`;
        const github = async (path: string, body?: object, method = body ? "PUT" : "GET") => {
          const response = await request(path, {
            method,
            headers: {
              authorization: `Bearer ${token}`,
              accept: "application/vnd.github+json",
              "x-github-api-version": "2026-03-10",
              ...(body ? { "content-type": "application/json" } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: AbortSignal.timeout(15_000),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.message ?? `GitHub returned ${response.status}`);
          if (data.errors?.length) throw new Error(data.errors[0].message ?? "GitHub returned GraphQL errors.");
          return data;
        };
        const pr = await github(url);
        if (pr.merged) return;
        if (pr.state !== "open") throw new Error("The PR is closed.");
        if (typeof pr.head?.sha !== "string" || !pr.head.sha) throw new Error("GitHub did not return the PR's head SHA.");
        if (pr.draft) {
          if (typeof pr.node_id !== "string" || !pr.node_id) throw new Error("GitHub did not return the PR's node ID.");
          const ready = await github("https://api.github.com/graphql", {
            query: "mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft } } }",
            variables: { id: pr.node_id },
          }, "POST");
          if (ready.data?.markPullRequestReadyForReview?.pullRequest?.isDraft !== false) {
            throw new Error("GitHub did not mark the PR ready for review.");
          }
        }
        const result = await github(`${url}/merge`, { sha: pr.head.sha, merge_method: "merge" });
        if (!result.merged) throw new Error(result.message ?? "GitHub did not merge the PR.");
      } catch (error) {
        const requester = event.actor?.handle ?? event.payload.by.actor;
        const emoji = event.payload.emoji === "approved" ? ":approved:" : ":shipit:";
        const reason = error instanceof Error ? error.message : String(error);
        await options.tellPi({
          task: "review",
          thread: root.id,
          key: `shipit-${event.index}`,
          message: [
            `${requester} (${event.payload.by.actor}) reacted with ${emoji} to request a merge of ${root.labels.pr} in board thread #${root.id}.`,
            `The factory couldn't merge it: ${reason}`,
            `Read the thread and inspect the PR's current state, checks, and reviews. Carry out the requested merge: resolve the blockers you can, mark a draft ready if needed, and merge when GitHub's requirements allow. Ping the appropriate reviewer or owner in the thread when needed, and explain what is still blocking it. The merge request remains active; don't require another ${emoji} reaction.`,
          ].join("\n"),
        });
      }
    },
  };
}
