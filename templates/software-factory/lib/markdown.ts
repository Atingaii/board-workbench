import { headline, isDone, progress, type Setup, type Task } from "./setup.ts";

// The launcher for whatever doesn't ask for a page: an agent told "set up <this URL>". The same
// steps and tasks the page shows, checked on the same request, as a checklist.

/** A task as a checklist item: its help on the line under it, then each command in its own block. */
function item(task: Task): string[] {
  const help = [task.hint, task.link ? `[${task.link.label}](${task.link.href})` : ""].filter(Boolean).join(" ");
  const commands = (task.commands ?? []).flatMap((command) => ["", "  ```", `  ${command}`, "  ```"]);
  return [`- [${task.done ? "x" : " "}] ${task.label}`, ...(help ? [`  ${help}`] : []), ...commands, ...(commands.length ? [""] : [])];
}

/** The launcher as markdown. `inspect` is the command that opens this factory's board. */
export function markdown(setup: Setup, inspect: string): string {
  const { title, lede } = headline(setup);
  if (setup.open) return [`# ${title}`, "", lede, "", ...item(setup.task)].join("\n").trimEnd() + "\n";
  const { done, of, running } = progress(setup.steps);
  const lines = [`# ${title}`, "", `${lede} ${done} of ${of} steps done, checked on this request.`];
  setup.steps.forEach((step, i) => {
    const state = isDone(step) ? " (done)" : step.optional ? " (optional)" : "";
    const tasks = step.tasks.flatMap(item);
    // A task that ends on a command already left a blank line.
    while (tasks.at(-1) === "") tasks.pop();
    lines.push("", `## ${i + 1}. ${step.title}${state}`, "", ...tasks);
  });
  if (running) lines.push("", "## Watch the board", "", "```", inspect, "```");
  return lines.join("\n") + "\n";
}

/**
 * What to paste to an agent to have it set this factory up: the deployment, and how to read it. A
 * deployment is behind Vercel Authentication, which a plain fetch doesn't get through and the Vercel
 * CLI does, as whoever is signed in.
 */
export function agentPrompt(origin: string, local: boolean): string {
  return local
    ? `Set up ${origin}\n\nIt answers its steps as markdown: curl ${origin}`
    : `Set up ${origin}\n\nIt's behind Vercel Authentication. Read it with the Vercel CLI, which gets its steps as markdown: vercel curl ${origin}`;
}
