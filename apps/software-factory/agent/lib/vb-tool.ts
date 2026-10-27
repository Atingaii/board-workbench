import { board as boardAt, type Board } from "@vercel/board";
import { http } from "@vercel/board/backend-http";
import { actorName, formatSchedule, formatThreads, formatThreadSummaries, reactionNames, terminalText } from "@vercel/board/format";
import { z } from "zod";
import { BOARD, eveAvatar, eveHeaders, eveName, SANDBOX_USER } from "../../app/api/board/[[...path]]/harness.ts";

// The vb tool: what Eve does on the board most (read, reply, react, label, typing), straight from
// the function to the board, without starting `vb` in the sandbox. It's who `vb` is there: the same
// token, profile, and session the sandbox's network policy adds.

export const ACTIONS = ["read", "reply", "react", "label", "typing"] as const;

/** An attachment is at most this big, as `vb reply --attach` takes it in one request. */
const ATTACH_BYTES_MAX = 4 * 1024 * 1024;

export const inputSchema = z.object({
  action: z.enum(ACTIONS),
  target: z
    .string()
    .describe("A message ID (#42 or 42) for its thread, or for read also a Slack or GitHub link, or a channel (dev) to list its threads."),
  text: z.string().optional().describe("reply: the message. read on a channel: only threads matching this text."),
  label: z.array(z.string()).optional().describe("read on a channel: only threads with these labels (kind=bug, pr). label: k=v pairs to set."),
  unset: z.array(z.string()).optional().describe("label: keys to remove."),
  limit: z.number().int().positive().max(500).optional().describe("read on a channel: how many threads."),
  json: z.boolean().optional().describe("read: the board's JSON instead of text, as vb read --json (author.handle, attachments, labels)."),
  emoji: z.string().optional().describe("react: the emoji's name, like eyes or looking-bunny."),
  remove: z.boolean().optional().describe("react: take the reaction off."),
  status: z.string().optional().describe("typing: what you're doing, shown in Slack in place of Typing…"),
  attach: z
    .array(z.string())
    .optional()
    .describe("reply: files in the sandbox to attach (up to 4 MB each), absolute, in ~ or $HOME, or relative to the workspace root."),
});

export type BoardInput = z.infer<typeof inputSchema>;

/** A thread's Eve on the board, through `fetch`, with a fresh token for each request. */
export function eveBoard(
  thread: string,
  options: { token: () => Promise<string>; bypass?: string | undefined; fetch?: typeof fetch },
): Board {
  const send = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const withEve: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    for (const [name, value] of Object.entries(eveHeaders(thread, await options.token(), options.bypass))) headers.set(name, value);
    return send(input, { ...init, headers });
  };
  return boardAt({ backend: http(BOARD, { fetch: withEve }) }).as({ name: eveName(thread), avatar: eveAvatar(thread) });
}

const messageRef = (value: string) => /^#[^\s/]+$/.test(value) || /^\d+$/.test(value);
const idOf = (value: string) => {
  if (!messageRef(value)) throw new Error(`expected a message ID like #42, got: ${value}`);
  return value.replace(/^#/, "");
};

function labelPairs(values: string[] | undefined): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const value of values ?? []) {
    const at = value.indexOf("=");
    if (at <= 0) throw new Error(`labels look like key=value, got: ${value}`);
    pairs[value.slice(0, at)] = value.slice(at + 1);
  }
  return pairs;
}

/** The sandbox's home, where clones and skills live. */
export const SANDBOX_HOME = `/home/${SANDBOX_USER}`;

/** A path as the model writes it: `~/…` and `$HOME/…` are in the sandbox's home, as Eve's file tools read them. */
export const sandboxPath = (path: string, home = SANDBOX_HOME) => path.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/, home);

/** What vb warns on stderr: a mention that matched no one notifies no one. */
const unknown = (handles: string[] | undefined) =>
  handles?.length ? `\nwarning: ${handles.map((h) => `@${h}`).join(", ")} matched no one on the board, so it stays plain text and notifies no one` : "";

/** Runs one action as `vb` would, and says what `vb` would print. `readFile` reads the sandbox's files, for attachments. */
export async function runBoard(
  board: Board,
  input: BoardInput,
  readFile: (path: string) => Promise<Uint8Array | null>,
): Promise<string> {
  switch (input.action) {
    case "read": {
      const { target } = input;
      if (/^https?:\/\//i.test(target) || messageRef(target)) {
        const thread = /^https?:\/\//i.test(target) ? await board.linked(target) : await board.thread(idOf(target));
        const messages = [thread.message, ...thread.replies];
        if (input.json) return messages.map((m) => JSON.stringify(m)).join("\n");
        // Reactions name people who may not have written here: look up the ones that show.
        const authors = new Set(messages.map((m) => m.by.actor));
        const unnamed = reactionNames(messages).filter((id) => !authors.has(id));
        const known = unnamed.length
          ? new Map((await board.actors().catch(() => [])).filter((a) => unnamed.includes(a.id)).map((a) => [a.id, actorName(a)]))
          : new Map<string, string>();
        return [formatThreads(messages, known), ...(thread.schedules ?? []).map((s) => formatSchedule(s, { pad: "  " }))].join("\n");
      }
      const page = await board.threads({
        channel: target,
        ...(input.text ? { text: input.text } : {}),
        ...(input.label?.length ? { label: input.label } : {}),
        ...(input.limit ? { limit: input.limit } : {}),
      });
      // Nothing in a channel that doesn't exist is a typo, not an empty channel.
      if (!page.threads.length && !(await board.channels()).some((c) => c.path === target || c.path.startsWith(target.replace(/\/?$/, "/"))))
        throw new Error(`no channel ${target}: vb channels lists them`);
      if (input.json) return page.threads.map((t) => JSON.stringify(t)).join("\n");
      const count = `${page.threads.length} ${page.threads.length === 1 ? "thread" : "threads"}`;
      const list = page.threads.length ? `\n\n${formatThreadSummaries(page.threads, { channel: target.endsWith("/") })}` : "";
      return terminalText(`${target} · ${count} · cursor ${page.cursor}`) + list;
    }
    case "reply": {
      const id = idOf(input.target);
      const files: { path: string; data: Uint8Array }[] = [];
      for (const path of input.attach ?? []) {
        const data = await readFile(sandboxPath(path));
        if (!data) throw new Error(`no such file: ${path}`);
        if (data.byteLength > ATTACH_BYTES_MAX) throw new Error(`${path} is over 4 MB, the most an attachment can be`);
        files.push({ path, data });
      }
      if (!input.text && !files.length) throw new Error("reply needs text or attach");
      const attachments = [];
      for (const { path, data } of files)
        attachments.push(await board.upload({ data: new Uint8Array(data), name: path.split("/").pop() || "file" }));
      const message = await board.reply(id, { text: input.text ?? "", ...(attachments.length ? { attachments } : {}) });
      return `${message.id}${unknown(message.unknownMentions)}`;
    }
    case "react": {
      if (!input.emoji) throw new Error("react needs emoji");
      await board.react(idOf(input.target), input.emoji, input.remove ? { remove: true } : {});
      return "ok";
    }
    case "label": {
      const set = labelPairs(input.label);
      const unset = input.unset ?? [];
      if (!Object.keys(set).length && !unset.length) throw new Error("label needs label (k=v) or unset");
      await board.label(idOf(input.target), { set, unset });
      return "ok";
    }
    case "typing": {
      await board.typing(idOf(input.target), input.status?.trim() || undefined);
      return "ok";
    }
  }
}
