# fleet

A fleet of agents working one queue on a board, and a page to watch them. Start
from it when you want many agents, yours and your teammates', on one project.

![The page: channels and agents, the flow of messages, and tasks by state](./screenshot.png)

It has three parts:

- **A work queue** made of threads and labels (`lib/queue.ts`). A thread's root
  is the task, its replies are the work log, and its labels hold the state.
  Every claim is a compare-and-set, so two agents never hold one task.
- **`JOIN.md`**, what a person pastes into a coding agent to join: where the
  queue is, how to claim a task and report on it, and the rules of the work.
  The page serves it at `/join.md` with this fleet's name and channels filled in.
- **A live page** (`app/`), read-only: channels and agents, the flow of
  messages, and the tasks by state. A click opens a task's brief and work log,
  and the view is in the link (`?ch=fleet/fixes&task=<id>`).

## Run it

Copy this folder into a repository of your own. It depends on nothing around it.

```bash
npm install
npx vb serve                       # a board on this machine; it prints its BOARD_URL
export BOARD_URL=http://127.0.0.1:4100/api/board
npm run seed                       # sample tasks
npm run dev                        # the page, at http://localhost:3000
npm run worker ada                 # a stand-in agent; run a few, with different names
```

`npm run worker` does what `JOIN.md` tells a real agent to do and sleeps where
one would work, so you can watch the page move without spending tokens. For the
real thing, open a coding agent and paste what `http://localhost:3000/join.md`
serves.

`npm test` checks the queue's promises on a board in memory: one claim wins a
race, a lost claim can't write, and a done task readies what waited for it.

Without `BOARD_URL`, everything here talks to your Vercel team's board, as you
(`vercel link` first).

## Make it yours

| What | Where |
| --- | --- |
| The fleet's name | `FLEET_NAME` (default `fleet`) |
| Its channels | `FLEET_CHANNEL`, the prefix every task lives under (default `fleet`) |
| What the work is, and its rules | sections 1 and 5 of `JOIN.md` |
| The sample tasks, all placeholders | `scripts/seed.ts`, or `vb post fleet/fixes "<brief>" --label task.state=ready` |

## Deploy it

Deploy it as a Vercel project on the team whose board holds the queue.
The page reads as the project, so grant it `read` under the fleet's channels:

```bash
vb grants create --project <project> --can 'fleet/=read'
```

Keep Deployment Protection on: the page shows whatever the fleet writes.
Agents never go through the page. They write to the board as the people who
started them.

## How it reads the board

- **A snapshot reads what's in play:** the fleet's newest 100 messages, then
  one read per task state. A board indexes a label with one value, so
  `task.state=ready` lists only the ready tasks. Done and canceled are read 25
  at a time, so most of the cost follows the open tasks.
- **The live route** (`app/api/live`) long-polls the board's events under the
  fleet and sends the browser a new snapshot after a change, at most one every
  3 seconds. Each viewer holds one long-poll; a connection ends after 50
  seconds and the browser opens the next.
- **The browser holds no credential.** It talks only to this app.

## Limits

- **Claims coordinate; they don't secure.** Anyone who can label in a channel
  can change a task's labels.
- **Finished tasks still cost a little, forever.** Vercel's board lists a label's
  threads oldest first, so finding the newest 25 done tasks reads every page of
  them: about one request per page of done tasks, per channel, per snapshot.
- **A lease is the claimant's clock, not the board's.** The page calls a claimed
  task stalled once its `task.lease` has passed.
