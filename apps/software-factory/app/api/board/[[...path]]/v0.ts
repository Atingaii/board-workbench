import { v0 } from "v0";

// A v0 chat for an intake thread, created with the deployment's Vercel OIDC token. v0
// gives a project's chats its git link: with this Vercel project linked to vercel/v0,
// each chat works on its own v0/vboard-<chatId> branch there. With credentialAccess.github
// (vercel/v0#30977, flagged on for Vercel teams), the chat's sandbox can use gh as the
// GitHub App installation on that repo, so v0 opens the pull request itself.

/** The API only offers v0's own models: v0-mini, v0-pro (its default), v0-max, v0-max-fast. */
const MODEL = { modelId: "v0-max", imageGenerations: false } as const;

const TASK = {
  bug: "Here's a bug report about v0, Vercel's AI app builder. Find the cause and make the smallest fix.",
  feature: "Here's a feature request for v0, Vercel's AI app builder. Build the smallest version of it worth shipping.",
};

/** What v0 does with its change. The git remote is v0's proxy, so gh needs the repo spelled out. */
const DELIVER = `When you have a change worth reviewing, commit and push it to your current branch, then open a draft pull request with gh pr create -R vercel/v0 --draft --head "$(git branch --show-current)" --base main, with the source link below in its body. Then run git blame on the lines you changed (on main) to find who knows this code best, skipping bots. In your last reply, mention the pull request and that person's email. If nothing is worth changing, say why.`;

/** Starts the chat and returns as soon as v0 accepts it: the work keeps going in v0. */
export async function startV0({ kind, text, source }: { kind: "bug" | "feature"; text: string; source: string | null }) {
  const message = `${TASK[kind]}\n\n${text}\n\n${DELIVER}${source ? `\n\nSource: ${source}` : ""}`;
  const chat = await v0.chats.createAsync({
    message,
    modelConfiguration: MODEL,
    privacy: "team-edit",
    // The published SDK only types sharedNpm; the API takes github too.
    credentialAccess: { github: true } as { sharedNpm?: boolean },
    metadata: { from: "vboard", ...(source ? { source } : {}) },
  });
  if (chat.error) throw new Error(`v0 createAsync: ${JSON.stringify(chat.error)}`);
  const chatId = chat.data.chatId;
  await watch(chatId);
  return { id: chatId, url: `https://v0.app/chat/${chatId}` };
}

/**
 * Asks v0 to tell /api/v0-hook when this chat's replies finish (vercel/v0#30982, flagged
 * on for Vercel teams). If it fails, the report just doesn't get a follow-up.
 */
async function watch(chatId: string) {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const key = process.env.V0_HOOK_KEY;
  if (!host || !key) return;
  const url = new URL(`https://${host}/api/v0-hook`);
  url.searchParams.set("key", key);
  // The board's production deployment is behind Vercel Authentication.
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) url.searchParams.set("x-vercel-protection-bypass", bypass);
  const hook = await v0.webhooks
    .create({ name: `vboard ${chatId}`, events: ["message.finished"], url: url.toString(), chatId })
    .catch((error: unknown) => ({ error }));
  if (hook.error) console.warn("v0 webhook not registered", chatId, JSON.stringify(hook.error));
}

