// Services besides GitHub that the agent reaches with a key a person puts in the Vercel project's
// env. Like GitHub's token, a key never enters the sandbox: the network policy adds it to requests
// on the way out, and only in the threads of the channels `serviceChannels` (in channels.ts) gives
// the service. The sandbox's env holds a placeholder under the same name, so a CLI finds one.
// Only HTTP goes through the policy: a database's connection string would sit in the sandbox.

type Env = Record<string, string | undefined>;

export type Service = {
  /** The env var that holds the key, in the Vercel project and, as a placeholder, in the sandbox. */
  env: string;
  /** The hosts the key goes to. */
  hosts: string[];
  /** The headers that carry the key: `authorization: Bearer <key>` when left out. */
  headers?: (key: string) => Record<string, string>;
  /** The key's prefix, which a CLI may check before it sends anything: kept in the placeholder. */
  prefix?: RegExp;
  /** Env the sandbox gets as it is, since it's no secret: an org's ID, say. */
  passthrough?: string[];
};

/** This factory's services, each under the name `serviceChannels` gives a channel. One line adds one. */
export const services = {
  // stripe: { env: "STRIPE_API_KEY", hosts: ["api.stripe.com"], prefix: /^[a-z]{2}_(live|test)_/ },
  // An API that takes its key in a header of its own:
  // acme: { env: "ACME_API_KEY", hosts: ["api.acme.dev"], headers: (key) => ({ "x-api-key": key }) },
} satisfies Record<string, Service>;

export type ServiceName = keyof typeof services;

const PLACEHOLDER = "from-the-network-policy";

/** What the sandbox's env holds for each service whose key is set: a placeholder for the key, and its passthrough as is. */
export function placeholders(env: Env = process.env, all: Record<string, Service> = services): Record<string, string> {
  const out: Record<string, string> = {};
  for (const service of Object.values(all)) {
    const key = env[service.env];
    if (!key) continue;
    out[service.env] = `${key.match(service.prefix ?? /^$/)?.[0] ?? ""}${PLACEHOLDER}`;
    for (const name of service.passthrough ?? []) if (env[name]) out[name] = env[name]!;
  }
  return out;
}

/** The services a thread in `channel` gets: those `serviceChannels` gives that channel exactly. */
export function threadServices<Name extends string>(channel: string | null | undefined, serviceChannels: Record<string, readonly Name[]>): Name[] {
  if (!channel) return [];
  return [...(serviceChannels[channel] ?? [])];
}

/** The network policy's rules that add each of `names`' keys on the way out, for those whose key is set. */
export function serviceRules(names: readonly string[], env: Env = process.env, all: Record<string, Service> = services) {
  const rules: Record<string, { transform: { headers: Record<string, string> }[] }[]> = {};
  for (const name of names) {
    const service = all[name];
    const key = service && env[service.env];
    if (!key) continue;
    const headers = service.headers?.(key) ?? { authorization: `Bearer ${key}` };
    for (const host of service.hosts) rules[host] = [{ transform: [{ headers }] }];
  }
  return rules;
}
