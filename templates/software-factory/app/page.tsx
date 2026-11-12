import { headers } from "next/headers";
import type { ReactNode } from "react";
import { boardName, connectors, factory, repoChannels, slackChannels } from "@/app/api/board/[[...path]]/factory";
import { Copy } from "@/components/copy";
import { Refresh } from "@/components/refresh";
import { Stepper, Tasks } from "@/components/stepper";
import { boardDeps, inspectCommand, isDone, liveDeps, projectOf, setup } from "@/lib/setup";

// Every load checks this deployment as it is now.
export const dynamic = "force-dynamic";

export default async function Launcher(): Promise<ReactNode> {
  const deps = await liveDeps(boardDeps(factory), { connectors, repoChannels, slackChannels, board: boardName });
  // The host this page is open on: a preview can be open while production is closed.
  deps.host = (await headers()).get("host");
  const result = await setup(deps);

  // Anyone can open this page: it says how to close it, and nothing about the factory.
  if (result.open) {
    return (
      <main className="launcher">
        <section className="hero">
          <h1>Protect this deployment first</h1>
          <p className="lede">The setup shows once only your team can open this page.</p>
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
  const required = steps.filter((step) => !step.optional);
  const done = required.filter(isDone).length;
  const running = done === required.length;
  // Only Try it is left: it's waiting on someone to post, so the page checks again on its own.
  const waiting = !running && required.every((step) => step.id === "try" || isDone(step));
  const team = await deps.oidc().then((token) => projectOf(token)?.team, () => undefined);
  const inspect = inspectCommand(team, boardName);

  return (
    <main className="launcher">
      <section className="hero">
        <h1>{running ? "Your software factory is running" : "Set up your software factory"}</h1>
        <p className="lede">{running ? "Bring it issues, threads, and questions." : "An agent that takes your team's issues to pull requests."}</p>
        <div className="hero-links">
          <Refresh waiting={waiting} />
          <span className="progress">
            {done} of {required.length} done
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
