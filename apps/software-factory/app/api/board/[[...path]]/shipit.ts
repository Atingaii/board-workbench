import type { Watcher } from "vboard";
import { getToken } from "@vercel/connect";
import type { tellPi } from "./agent";

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
        event.payload.emoji !== "shipit" ||
        event.payload.from !== "slack" ||
        !event.payload.by.principal.startsWith("slack:user:") ||
        root?.re !== null
      ) return;
      const number = root.labels.pr?.match(/^basehub-ai\/vboard#([1-9]\d*)$/)?.[1];
      if (!number) return;
      try {
        const token = await (options.token?.() ?? getToken("github/vboard-factory", { subject: { type: "app" } }));
        const url = `https://api.github.com/repos/basehub-ai/vboard/pulls/${number}`;
        const github = async (path: string, body?: object) => {
          const response = await request(path, {
            method: body ? "PUT" : "GET",
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
          return data;
        };
        const pr = await github(url);
        if (pr.merged) return;
        if (pr.state !== "open") throw new Error("The PR is closed.");
        if (pr.draft) throw new Error("The PR is still a draft.");
        if (typeof pr.head?.sha !== "string" || !pr.head.sha) throw new Error("GitHub did not return the PR's head SHA.");
        const result = await github(`${url}/merge`, { sha: pr.head.sha, merge_method: "merge" });
        if (!result.merged) throw new Error(result.message ?? "GitHub did not merge the PR.");
      } catch (error) {
        const requester = event.actor?.handle ?? event.payload.by.actor;
        const reason = error instanceof Error ? error.message : String(error);
        await options.tellPi({
          task: "review",
          thread: root.id,
          key: `shipit-${event.index}`,
          message: [
            `${requester} (${event.payload.by.actor}) reacted with :shipit: to request a merge of ${root.labels.pr} in board thread #${root.id}.`,
            `The factory couldn't merge it: ${reason}`,
            "Read the thread and inspect the PR's current state, checks, and reviews. Figure out what's blocking the requested merge and help unblock it within your review role. Ping the appropriate reviewer or owner in the thread when needed, and explain the next step to the person who requested the merge.",
          ].join("\n"),
        });
      }
    },
  };
}
