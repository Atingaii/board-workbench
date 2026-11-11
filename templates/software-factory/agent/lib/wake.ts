import type { WatcherContext } from "@vercel/board";
import { byAgent, ORIGIN } from "./identity.ts";

// All the board sees of the agent: its watcher hands over every message posted where it tails, and
// reactions to the agent's own messages, with the GitHub access the thread gets. The agent reads the
// thread and decides what each needs.

/** The GitHub connector the agent acts through, and the repos the board brings in (`owner/name`). */
export type GitHubAccess = { github: string; repos: string[] };

/** One wake-up: the thread it's about, the event's cursor, and what to tell the agent. */
export type AgentMessage = { thread: string; key: string; text: string; github: GitHubAccess };

export type Deliver = (message: AgentMessage) => Promise<void>;

/** Who this deployment's own code writes as, read from the board once: the agent is a profile of it. */
let principal: Promise<string> | undefined;
const own = (board: Pick<WatcherContext["board"], "me">) =>
  (principal ??= board.me().then((me) => me.principal)).catch((error: unknown) => {
    principal = undefined;
    throw error;
  });

export async function wakeAgent({ event, board }: WatcherContext, github: GitHubAccess, deliver: Deliver = send): Promise<void> {
  const message = event.message;
  if (!message) return;
  const thread = message.re ?? message.id;
  let text: string;
  if (event.type === "message.posted") {
    // Its own messages don't wake it, except the reminders it schedules for itself.
    if (byAgent(message.by, await own(board)) && message.schedule === undefined) return;
    text = message.re ? `New message #${message.id} in board thread #${thread}.` : `New board thread #${thread}.`;
  } else if (event.type === "reaction.added") {
    const me = await own(board);
    if (!byAgent(message.by, me) || byAgent(event.payload.by, me)) return;
    text = `${event.actor?.name ?? "Someone"} reacted :${event.payload.emoji}: to your message #${message.id} in board thread #${thread}.`;
  } else return;
  await sendToAgent(board, { thread, key: event.cursor, text, github }, deliver);
}

/**
 * Delivers a message to the agent, trying 3 times, and says so in the thread if it never gets there.
 * Throwing instead would lose it quietly: the board retries a watcher a few times, then drops the event.
 */
export async function sendToAgent(board: Pick<WatcherContext["board"], "reply">, message: AgentMessage, deliver: Deliver = send, retryMs = 5_000) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await deliver(message);
    } catch (error) {
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, retryMs * attempt));
        continue;
      }
      console.error(`[factory] the agent couldn't start on board thread #${message.thread}:`, error);
      const reason = (error instanceof Error ? error.message : String(error)).split("\n")[0]!.slice(0, 200);
      await board.reply(message.thread, `The agent couldn't start: \`${reason}\`. Reply here to try again.`);
      return;
    }
  }
}

/**
 * Hands a wake-up to the thread's eve session, over eve's own channel on this deployment (/eve/v1),
 * as this deployment. eve keeps one session per `operationId`, so the thread's ID finds its session
 * or starts one, and it drops a delivery whose `idempotencyKey` it has seen, so a wake-up the board
 * delivers twice starts no second turn. Nothing here keeps a map of sessions. The board runs a
 * thread's events in order: two first wake-ups at the very same moment could each start a session.
 */
export async function send({ thread, key, text, github }: AgentMessage, request: typeof fetch = fetch): Promise<void> {
  const token = process.env.VERCEL_URL ? await (await import("@vercel/oidc")).getVercelOidcToken() : null;
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const post = async (path: string, body: object) => {
    const response = await request(`${ORIGIN}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(bypass ? { "x-vercel-protection-bypass": bypass } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const answer = (await response.json().catch(() => null)) as { sessionId?: string; code?: string; error?: string } | null;
    return { status: response.status, ok: response.ok, ...answer };
  };
  const failed = (what: string, answer: { status: number; code?: string; error?: string }) =>
    new Error(`eve answered ${answer.status} to ${what}${answer.code ? ` (${answer.code})` : ""}${answer.error ? `: ${answer.error}` : ""}`);
  const open = async () => {
    const opened = await post("/eve/v1/session", { operationId: `thread-${thread}` });
    if (!opened.ok || !opened.sessionId) throw failed("opening the thread's session", opened);
    return opened.sessionId;
  };
  const deliver = (session: string) => post(`/eve/v1/session/${session}`, { message: text, clientContext: { board: { thread, ...github } }, idempotencyKey: key });
  let sent = await deliver(await open());
  // The session ended since it was found (idle for too long, or reset): the thread gets a new one.
  if (sent.code === "session_not_active") sent = await deliver(await open());
  if (!sent.ok) throw failed("a wake-up", sent);
}
