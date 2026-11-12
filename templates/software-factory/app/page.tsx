import { headers } from "next/headers";
import type { ReactNode } from "react";
import { Copy } from "@/components/copy";
import { Refresh } from "@/components/refresh";
import { Stepper, Tasks } from "@/components/stepper";
import { check } from "@/lib/launcher";
import { agentPrompt } from "@/lib/markdown";
import { headline, isDone, progress } from "@/lib/setup";

// Every load checks this deployment as it is now.
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
          <div className="hero-links">
            <Refresh waiting={false} />
          </div>
        </section>
        <section className="next">
          <Tasks tasks={[result.task]} />
        </section>
      </main>
    );
  }

  const { steps } = result;
  const { done, of, running } = progress(steps);
  // Only Try it is left: it's waiting on someone to post, so the page checks again on its own.
  const waiting = !running && steps.every((step) => step.optional || step.id === "try" || isDone(step));

  return (
    <main className="launcher">
      <section className="hero">
        <h1>{title}</h1>
        <p className="lede">{lede}</p>
        <div className="hero-links">
          <Refresh waiting={waiting} />
          {running ? null : <Copy text={agentPrompt(origin, local)} label="Copy prompt" />}
          <span className="progress">
            {done} of {of} done
          </span>
        </div>
      </section>
      <Stepper steps={steps} />
      {running ? (
        <section className="next">
          <h2>Watch the board</h2>
          <div className="command">
            <pre>
              <code>{inspect}</code>
            </pre>
            <Copy text={inspect} />
          </div>
        </section>
      ) : null}
    </main>
  );
}
