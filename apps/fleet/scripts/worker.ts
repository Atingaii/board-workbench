// A stand-in agent, to watch the page move without spending tokens: node scripts/worker.ts [name]
// It does what JOIN.md tells a real agent to do (claim, log, renew, finish) and sleeps where a real
// one would work. STEP_MS sets how long each step takes (3 s by default). Stop it with Ctrl-C.
import { FLEET, team } from "../lib/board.ts";
import { claim, finish, renew, review } from "../lib/queue.ts";

const name = process.argv[2] ?? `worker-${Math.random().toString(36).slice(2, 6)}`;
const board = team().as(name);
const me = (await board.me()).handle ?? name;
const step = Number(process.env.STEP_MS ?? 3_000);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

console.log(`${me} is working ${FLEET}`);
for (;;) {
  // Someone else's finished work comes first: a review readies what waits for it.
  const reviews = await board.threads({ channel: FLEET, label: { "task.state": "review" } });
  const theirs = reviews.threads.find(({ message }) => message.labels["task.owner"] !== me);
  if (theirs && (await review(board, theirs.message.id, "done", FLEET))) {
    await board.reply(theirs.message.id, "Reviewed: the result holds. Done.");
    console.log(`reviewed ${theirs.message.id}`);
    continue;
  }

  const { threads } = await board.threads({ channel: FLEET, label: { "task.state": "ready" } });
  if (threads.length === 0) {
    // Nothing to take: block until something in the fleet changes, then look again.
    await board.wait({ channel: FLEET }, { timeout: "1m" });
    continue;
  }
  const { message } = threads[Math.floor(Math.random() * threads.length)]!;
  const token = await claim(board, message.id, me);
  if (!token) continue; // someone was first

  const title = message.text.split("\n", 1)[0];
  console.log(`claimed ${message.id}  ${title}`);
  await board.reply(message.id, "[progress] Claimed. Plan: reproduce, change, verify, report.");
  let held = true;
  for (const note of ["[progress] Reproduced it. Working on the change.", "[progress] Change made. Verifying."]) {
    await sleep(step);
    // A lost claim means someone took the task over: stop, and write nothing more to its state.
    if (!(held = await renew(board, message.id, token))) break;
    await board.reply(message.id, note);
  }
  if (!held) {
    await board.reply(message.id, "Lost the claim, so stopping here.");
    continue;
  }
  await sleep(step);
  const state = Math.random() < 0.5 ? "review" : "done";
  if (await finish(board, message.id, token, state, FLEET)) {
    await board.reply(message.id, state === "review" ? "Ready for review: the change is verified." : "Done: verified.");
    console.log(`${state} ${message.id}`);
  }
}
