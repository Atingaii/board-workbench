import type { Task } from "./harness.ts";

// The eve agent (`agent/` in this app, mounted at /eve/v1 by `withEve`): the same work as Pi, on eve's harness.
// Each thread's task gets one durable eve session; this file finds it, or starts it, and sends it the message.
// eve queues a message behind a running turn (the eve channel's `turnPolicy: "queue"`), so there's no lock here.

/**
 * Whether a thread goes to the eve agent: `FACTORY_EVE_FROM` names the first thread that does, so threads Pi
 * already has keep their Pi (eve can't pick up a Pi session's history). Unset, everything stays with Pi.
 */
export function eveHarness(thread: string, from = process.env.FACTORY_EVE_FROM) {
  if (!from || !/^\d{1,15}$/.test(from) || !/^\d{1,15}$/.test(thread)) return false;
  return Number(thread) >= Number(from);
}

/** What the eve agent is told: who it works for travels with each message, so its hooks and instructions know. */
export type EveMessage = { task: Task; thread: string; key: string; message: string };

/** The context that says which thread's agent a session is: the eve channel turns it into the session's identity. */
export const boardContext = (task: Task, thread: string) => ({ board: { task, thread } });

/** Where the factory keeps each thread's eve session, and which messages it already sent: a key-value store with set-if-absent. */
export type Sessions = {
  get(key: string): Promise<string | null>;
  /** Sets `key` only when it's unset; says whether it did. */
  claim(key: string, value: string): Promise<boolean>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

/** The eve sessions API, as much of it as the factory uses. */
export type EveSessions = {
  create(): Promise<string>;
  send(session: string, message: string, clientContext: object): Promise<void>;
  reset(session: string): Promise<void>;
};

/** A session that's gone: ended after its idle timeout, or reset, or built by an eve the deployment no longer runs. */
const gone = (error: unknown) =>
  error instanceof Error &&
  (error.name === "SessionNotActiveError" ||
    error.name === "ClientSessionStrandedError" ||
    (error as { code?: string }).code === "session_stranded");

/**
 * Sends the eve agent a message about a thread, once: `key` names it, as with Pi. The thread's session is made on
 * first use; two first messages racing each make one, and the loser's is reset so only one session holds the thread.
 */
export async function tellEve(
  { task, thread, key, message }: EveMessage,
  deps: { sessions?: Sessions; eve?: EveSessions } = {},
) {
  const sessions = deps.sessions ?? (await kv());
  const eve = deps.eve ?? (await client());
  const name = `${task}-${thread}`;
  if (!(await sessions.claim(`told:${name}:${key}`, "1"))) return;
  try {
    let session = await sessions.get(`session:${name}`);
    if (!session) {
      const made = await eve.create();
      if (await sessions.claim(`session:${name}`, made)) session = made;
      else {
        await eve.reset(made).catch(() => {});
        session = (await sessions.get(`session:${name}`))!;
      }
    }
    const context = boardContext(task, thread);
    try {
      await eve.send(session, message, context);
    } catch (error) {
      if (!gone(error)) throw error;
      // The thread starts over in a new session, as a Pi thread does when its sandbox's snapshot expires.
      const fresh = await eve.create();
      await sessions.set(`session:${name}`, fresh);
      await eve.send(fresh, message, context);
    }
  } catch (error) {
    // Not sent, so the next try (startOrSay's, or the next event's) sends it.
    await sessions.delete(`told:${name}:${key}`).catch(() => {});
    throw error;
  }
}

/** This deployment's eve agent, called as this deployment: its OIDC token, and past Vercel Authentication. */
async function client(): Promise<EveSessions> {
  const [{ Client }, { getVercelOidcToken }] = await Promise.all([import("eve/client"), import("@vercel/oidc")]);
  const host = process.env.VERCEL_URL;
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const eve = new Client({
    baseUrl: host ? `https://${host}` : `http://localhost:${process.env.PORT ?? 3000}`,
    ...(host ? { auth: { vercelOidc: { token: () => getVercelOidcToken() } } } : {}),
    ...(bypass ? { headers: { "x-vercel-protection-bypass": bypass } } : {}),
  });
  return {
    create: async () => (await eve.sessions.create()).session.id,
    send: async (session, message, clientContext) => {
      await eve.sessions.attach(session).send(message, { clientContext: clientContext as never });
    },
    reset: async (session) => {
      await eve.sessions.attach(session).reset();
    },
  };
}

/**
 * The factory's Upstash, under its own prefix per environment like the board's tables (`a2.ts`), or memory locally.
 */
async function kv(): Promise<Sessions> {
  const env = process.env.VERCEL_ENV;
  if (!env) return memory();
  const prefix = env === "production" ? "board-factory-eve" : `board-factory-eve:${env}`;
  const call = async (...command: string[]) => {
    const response = await fetch(process.env.KV_REST_API_URL!, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await response.json()) as { result?: unknown; error?: string };
    if (!response.ok || data.error) throw new Error(`Upstash: ${data.error ?? response.status}`);
    return data.result;
  };
  return {
    get: async (key) => ((await call("GET", `${prefix}:${key}`)) as string | null) ?? null,
    claim: async (key, value) => (await call("SET", `${prefix}:${key}`, value, "NX")) === "OK",
    set: async (key, value) => void (await call("SET", `${prefix}:${key}`, value)),
    delete: async (key) => void (await call("DEL", `${prefix}:${key}`)),
  };
}

const local = new Map<string, string>();

/** A `Sessions` in memory: locally, and in tests. */
export function memory(map = local): Sessions {
  return {
    get: async (key) => map.get(key) ?? null,
    claim: async (key, value) => (map.has(key) ? false : (map.set(key, value), true)),
    set: async (key, value) => void map.set(key, value),
    delete: async (key) => void map.delete(key),
  };
}
