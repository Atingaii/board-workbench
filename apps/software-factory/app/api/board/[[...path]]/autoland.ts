import type { Watcher } from "vboard";
import { getToken } from "@vercel/connect";
import type { byPi } from "./agent";

// Auto-land, in shadow mode: it decides whether a factory PR would land on its own,
// and labels the PR thread with the decision, but merges nothing. The reviewer (the
// PR thread's Pi, a session apart from the one that wrote it) judges what code can't:
// `land=yes|no`, `land.why`, and `land.sha`, the head it reviewed. Code checks the rest.

const REPO = "basehub-ai/vboard";
const API = `https://api.github.com/repos/${REPO}`;
/** Only PRs the factory opened can land on their own. */
const FACTORY = "vboard-factory[bot]";
/** The CI job a PR's head must pass (`.github/workflows/check.yml`). */
const CHECK = "check";
/** vboard core: the published package's source. */
const CORE = "packages/vboard/src/";
/** A user-facing change gets a changeset; the folder's README isn't one. */
const isChangeset = (path: string) => /^\.changeset\/[^/]+\.md$/.test(path) && path !== ".changeset/README.md";

export type PullRequest = { state: string; merged: boolean; user: { login: string }; head: { sha: string } };
export type ChangedFile = { filename: string; status: string };
export type CheckRun = { name: string; status: string; conclusion: string | null };
export type Review = { land?: string | undefined; why?: string | undefined; sha?: string | undefined };

/** Whether a PR would auto-land, and the one reason. The first rule it fails decides. */
export function decide(review: Review, pr: PullRequest, files: ChangedFile[], checks: CheckRun[]) {
  const no = (why: string) => ({ would: false, why });
  if (review.land !== "yes") return no(`review: ${review.why || "not landable"}`);
  if (pr.user.login !== FACTORY) return no(`opened by ${pr.user.login}, not the factory`);
  if (pr.merged || pr.state !== "open") return no(`the PR is ${pr.merged ? "merged" : pr.state}`);
  if (review.sha !== pr.head.sha) return no("new commits since the review");
  const check = checks.find((run) => run.name === CHECK);
  if (check?.status !== "completed" || check.conclusion !== "success") {
    return no(`CI \`${CHECK}\` ${check ? (check.conclusion ?? check.status) : "hasn't run"}`);
  }
  const live = files.filter((file) => file.status !== "removed");
  const core = files.some((file) => file.filename.startsWith(CORE));
  const userFacing = live.some((file) => isChangeset(file.filename));
  if (core && userFacing) return no("user-facing change to vboard core");
  return { would: true, why: core ? "internal change to vboard core" : "outside vboard core" };
}

/** Labels hold up to 256 characters. */
const clip = (text: string) => (text.length > 256 ? `${text.slice(0, 255)}…` : text);

export function autoland(options: { byPi: typeof byPi; token?: () => Promise<string>; fetch?: typeof fetch }): Watcher {
  const request = options.fetch ?? globalThis.fetch;
  return {
    tail: "--label pr",
    run: async ({ event, board }) => {
      const root = event.message;
      if (
        event.type !== "labels.changed" ||
        !("land" in event.payload.set) ||
        !root ||
        root.re !== null ||
        !options.byPi(root.id, event.payload.by)
      ) return;
      const number = root.labels.pr?.match(/^basehub-ai\/vboard#([1-9]\d*)$/)?.[1];
      if (!number) return;
      let decision: { would: boolean; why: string };
      try {
        const token = await (options.token?.() ?? getToken("github/vboard-factory", { subject: { type: "app" } }));
        const github = async (path: string) => {
          const response = await request(`${API}${path}`, {
            headers: {
              authorization: `Bearer ${token}`,
              accept: "application/vnd.github+json",
              "x-github-api-version": "2026-03-10",
            },
            signal: AbortSignal.timeout(15_000),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.message ?? `GitHub returned ${response.status}`);
          return data;
        };
        const pr: PullRequest = await github(`/pulls/${number}`);
        const files: ChangedFile[] = [];
        // GitHub lists up to 3000 files, 100 a page.
        for (let page = 1; page <= 30; page++) {
          const batch: ChangedFile[] = await github(`/pulls/${number}/files?per_page=100&page=${page}`);
          files.push(...batch);
          if (batch.length < 100) break;
        }
        const { check_runs }: { check_runs: CheckRun[] } = await github(
          `/commits/${pr.head.sha}/check-runs?check_name=${CHECK}&filter=latest`,
        );
        decision = decide(
          { land: root.labels.land, why: root.labels["land.why"], sha: root.labels["land.sha"] },
          pr,
          files,
          check_runs,
        );
      } catch (error) {
        decision = { would: false, why: `couldn't read the PR: ${error instanceof Error ? error.message : String(error)}` };
      }
      await board.label(root.id, {
        set: { autoland: decision.would ? "would" : "no", "autoland.why": clip(decision.why) },
      });
    },
  };
}
