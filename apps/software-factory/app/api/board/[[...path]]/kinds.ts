/**
 * The kinds triage gives a dev thread: what each means to the classifier, and how Pi is
 * told about one. Every kind but noise goes to Pi, so a request for Pi itself to do
 * something (a recap, an investigation) reaches it instead of reading as chatter.
 */
export const KINDS = {
  bug: { criteria: "Something in vboard is broken or behaves wrongly.", task: "a bug report" },
  feature: { criteria: "A request for something vboard doesn't do yet.", task: "a feature request" },
  question: { criteria: "Someone asking how something works.", task: "a question" },
  task: {
    criteria:
      "Someone asking the vboard bot (Pi) to do something for them: a recap or summary, an investigation, a chore. Includes follow-ups chasing it (\"status?\", \"hello?\").",
    task: "a task for you",
  },
  noise: { criteria: "Chatter, an announcement, or nothing to act on.", task: null },
} as const;

export type Kind = keyof typeof KINDS;
export type PiKind = { [K in Kind]: (typeof KINDS)[K]["task"] extends null ? never : K }[Kind];

export const PI_KINDS = (Object.keys(KINDS) as Kind[]).filter((k): k is PiKind => KINDS[k].task !== null);
export const isPiKind = (kind: string): kind is PiKind => (PI_KINDS as string[]).includes(kind);
export const piTask = (kind: PiKind): string => KINDS[kind].task;
export const CRITERIA = Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v.criteria])) as Record<Kind, string>;
