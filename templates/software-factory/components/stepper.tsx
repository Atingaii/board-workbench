import type { ReactNode } from "react";
import { Check as Tick, Circle } from "lucide-react";
import { isDone, type Fix, type Step } from "@/lib/setup";
import { Copy } from "./copy";

/** What to do about something: a line, then each command in its own box, or a link. */
export function Todo({ fix }: { fix: Fix }): ReactNode {
  return (
    <div className="todo">
      <p>{fix.text}</p>
      {fix.commands?.map((command) => (
        <div key={command} className="command">
          <pre>
            <code>{command}</code>
          </pre>
          <Copy text={command} />
        </div>
      ))}
      {fix.link ? (
        <a className="button secondary" href={fix.link.href} target="_blank" rel="noreferrer">
          {fix.link.label}
        </a>
      ) : null}
    </div>
  );
}

/** The steps, in order, each with its checks: what's there, and what to do about what isn't. */
export function Stepper({ steps }: { steps: Step[] }): ReactNode {
  const icon = { size: 14, strokeWidth: 2.5, "aria-hidden": true } as const;
  return (
    <ol className="stepper">
      {steps.map((step, i) => {
        const done = isDone(step);
        return (
          <li key={step.id} className="step" data-done={done ? "" : undefined}>
            <span className="marker">{done ? <Tick {...icon} /> : <span>{i + 1}</span>}</span>
            <div className="step-body">
              <div className="step-head">
                <h2>{step.title}</h2>
                <span className="status">{done ? "Done" : step.optional ? "Optional" : "To do"}</span>
              </div>
              <ul className="checks">
                {step.checks.map((check) => (
                  <li key={check.label} data-done={check.done ? "" : undefined}>
                    {check.done ? <Tick {...icon} /> : <Circle {...icon} />}
                    <div>
                      <p>{check.label}</p>
                      {check.fix ? <Todo fix={check.fix} /> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
