import type { Watcher } from "vboard";
import { getToken } from "@vercel/connect";

export function shipit(options: {
  token?: () => Promise<string>;
  fetch?: typeof fetch;
} = {}): Watcher {
  const request = options.fetch ?? globalThis.fetch;
  return {
    tail: "--label pr",
    run: async ({ event, board }) => {
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
        await board.reply(root.id, `Couldn't merge ${root.labels.pr}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}
