import { headers } from "next/headers";
import type { ReactNode } from "react";
import { Copy } from "@/components/copy";
import { Live } from "@/components/live";
import { Stepper, Tasks } from "@/components/stepper";
import { check } from "@/lib/launcher";
import { agentPrompt, asksFor } from "@/lib/markdown";
import { headline, progress } from "@/lib/setup";

// Every load checks this deployment as it is now, and the page asks again by itself (components/live.tsx).
export const dynamic = "force-dynamic";

export default async function Launcher(): Promise<ReactNode> {
  // The host this page is open on.
  const { result, inspect, origin, local } = await check((await headers()).get("host"));
  const { title, lede } = headline(result);

  // Anyone can open this page: it says how to close it, and nothing about the factory.
  if (result.open) {
    return (
      <main className="launcher">
        <section className="hero">
          <h1>{title}</h1>
          <p className="lede">{lede}</p>
        </section>
        <section className="next">
          <Tasks tasks={[result.task]} />
        </section>
        <Live polling />
      </main>
    );
  }

  const { steps } = result;
  const { done, of, running } = progress(steps);

  return (
    <main className="launcher">
      <section className="hero">
        <h1>{title}</h1>
        <p className="lede">{lede}</p>
        <div className="hero-links">
          {running ? null : <Copy text={agentPrompt(origin, local)} label="Copy prompt" />}
          <span className="progress">
            {done} of {of} done
          </span>
        </div>
      </section>
      <Stepper steps={steps} />
      {/* While a step is left, it can get done at any moment, somewhere else. Once it runs, coming back is enough. */}
      <Live polling={!running} />
      {asksFor(steps, inspect) ? null : (
        <section className="next">
          <h2>Watch the board</h2>
          <div className="command">
            <pre>
              <code>{inspect}</code>
            </pre>
            <Copy text={inspect} />
          </div>
        </section>
      )}
    </main>
  );
}
