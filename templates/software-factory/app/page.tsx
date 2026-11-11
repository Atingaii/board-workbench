import { headers } from "next/headers";
import type { ReactNode } from "react";
import { boardName, connectors, factory, repoChannels, slackChannels } from "@/app/api/board/[[...path]]/factory";
import { Copy } from "@/components/copy";
import { Refresh } from "@/components/refresh";
import { Stepper } from "@/components/stepper";
import { boardDeps, liveDeps, projectOf, setup } from "@/lib/setup";

// Every load checks this deployment as it is now.
export const dynamic = "force-dynamic";

export default async function Launcher(): Promise<ReactNode> {
  const deps = await liveDeps(boardDeps(factory), { connectors, repoChannels, slackChannels });
  // The host this page is open on: a preview can be open while production is closed.
  deps.host = (await headers()).get("host");
  const steps = await setup(deps);
  const required = steps.filter((step) => !step.optional);
  const done = required.filter((step) => step.status === "done").length;
  const current = required.find((step) => step.status !== "done");
  // The board is the team's, in Vercel's API: vb opens it as you, from anywhere.
  const team = await deps.oidc().then((token) => projectOf(token)?.team, () => undefined);
  const inspect = `npx @vercel/board inspect${team ? ` --scope ${team}` : ""}${boardName ? ` --name ${boardName}` : ""}`;

  return (
    <main className="launcher">
      <section className="hero">
        <h1>{current ? "Set up your software factory" : "Your software factory is running"}</h1>
        <p className="lede">{current ? "An agent that takes your team's issues to pull requests." : "Bring it issues, threads, and questions."}</p>
        <div className="hero-links">
          <Refresh waiting={steps.some((step) => step.status === "waiting")} />
          <span className="progress">
            {done} of {required.length} done
          </span>
        </div>
      </section>
      <Stepper steps={steps} current={current?.id} />
      <section className="next">
        <h2>Watch the board</h2>
        <div className="command">
          <pre>
            <code>{inspect}</code>
          </pre>
          <Copy text={inspect} />
        </div>
      </section>
    </main>
  );
}
