"use client";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

type Tone = "line" | "ink" | "on";
type Cell = { char: string; tone: Tone };
type Place = "slack" | "agent" | "github";
type Point = [x: number, y: number];

/**
 * One PR's whole life in one board thread. Each event happens in one place, goes
 * up the wire into the board's log, and fans out to the other two places.
 */
const EVENTS: {
  id: number;
  from: Place;
  author: string;
  text: string;
  /** The PR root's labels once the event lands, when it changes them. */
  labels?: string;
  /** How each place shows it. */
  rows: Record<Place, string>;
}[] = [
  {
    id: 812,
    from: "github",
    author: "julian (github)",
    text: "PR #42 fix safari",
    labels: "state=open",
    rows: { github: "julian opened #42", slack: "julian  PR #42", agent: "#812 julian: PR #42" },
  },
  {
    id: 813,
    from: "slack",
    author: "ada (slack)",
    text: "can you check iOS too?",
    rows: { slack: "ada     check iOS?", github: "ada: check iOS?", agent: "#813 ada: check iOS?" },
  },
  {
    id: 815,
    from: "agent",
    author: "claude via julian",
    text: "fixed iOS too",
    rows: { agent: "#815 claude: fixed iOS", slack: "claude  fixed iOS", github: "claude: fixed iOS" },
  },
  {
    id: 816,
    from: "github",
    author: "grace (github)",
    text: "approved",
    labels: "state=open review=approved",
    rows: { github: "grace approved", slack: "grace   approved", agent: "#816 grace: approved" },
  },
  {
    id: 817,
    from: "github",
    author: "julian (github)",
    text: "merged",
    labels: "state=merged review=approved",
    rows: { github: "julian merged #42", slack: "julian  merged", agent: "#817 julian: merged" },
  },
];

const PLACES: Place[] = ["slack", "agent", "github"];
const WIDTH = 76;
/** Each place's box, and where its wire drops into the top border, clear of the title. */
const BOXES: Record<Place, { x: number; w: number; title: string; right?: true; stem: number }> = {
  slack: { x: 0, w: 22, title: "slack #prs", stem: 18 },
  agent: { x: 24, w: 28, title: "agent", stem: 38 },
  github: { x: 54, w: 22, title: "github #42", right: true, stem: 57 },
};
const BOARD = { x: 11, w: 55, title: "board · prs" };
/** Where the board's own wire meets the bus. */
const HUB = 38;

/** Under the log, a rule, then the PR root's labels. */
const RULE_Y = EVENTS.length + 1;
const LABELS_Y = EVENTS.length + 2;
const BOARD_BOTTOM = EVENTS.length + 3;
const BUS = BOARD_BOTTOM + 2;
const PLACES_Y = BUS + 2;
const HEIGHT = PLACES_Y + EVENTS.length + 2;

/** The wire from a place up to the board, cell by cell. */
function wire(place: Place): Point[] {
  const { stem } = BOXES[place];
  const cells: Point[] = [
    [stem, PLACES_Y],
    [stem, PLACES_Y - 1],
  ];
  const step = Math.sign(HUB - stem);
  for (let x = stem; x !== HUB; x += step) cells.push([x, BUS]);
  cells.push([HUB, BUS], [HUB, BUS - 1], [HUB, BOARD_BOTTOM]);
  return cells;
}

// In ticks: an event shows where it happened, rides the wire up into the board,
// then out to the other places, and settles.
const APPEAR = 5;
const HOLD = 5;
const SETTLE = 10;
const TRAIL = 4;
/** A pulse runs along the wire in heavy strokes. */
const HEAVY: Record<string, string> = { "─": "━", "│": "┃", "┼": "╋", "┬": "┳", "┴": "┻", "┌": "┏", "┐": "┓" };
const TICK_MS = 32;

/** When each event reaches each place. */
const TIMELINE = (() => {
  let start = 0;
  return EVENTS.map((event) => {
    const up = wire(event.from);
    const board = start + APPEAR + up.length;
    const downs = PLACES.filter((place) => place !== event.from).map((place) => {
      const path = [...wire(place)].reverse();
      return { place, path, start: board + HOLD, arrive: board + HOLD + path.length };
    });
    const timing = { start, up, board, downs, end: Math.max(...downs.map((down) => down.arrive)) + SETTLE };
    start = timing.end;
    return timing;
  });
})();
const LOOP = TIMELINE.at(-1)!.end + 40;

function draw(tick: number): Cell[][] {
  const grid = Array.from({ length: HEIGHT }, () =>
    Array.from({ length: WIDTH }, (): Cell => ({ char: " ", tone: "line" })),
  );
  const put = (x: number, y: number, text: string, tone: Tone): void => {
    [...text].forEach((char, i) => {
      const cell = grid[y]?.[x + i];
      if (cell) Object.assign(cell, { char, tone });
    });
  };
  const light = ([x, y]: Point): void => {
    const cell = grid[y]?.[x];
    if (cell) Object.assign(cell, { char: HEAVY[cell.char] ?? cell.char, tone: "on" });
  };
  const box = (x: number, y: number, w: number, h: number, title: string, right = false): void => {
    const rule = "─".repeat(w - title.length - 5);
    put(x, y, right ? `┌${rule} ${title} ─┐` : `┌─ ${title} ${rule}┐`, "line");
    for (let row = y + 1; row < y + h - 1; row++) {
      put(x, row, "│", "line");
      put(x + w - 1, row, "│", "line");
    }
    put(x, y + h - 1, `└${"─".repeat(w - 2)}┘`, "line");
  };

  // The board, its wire, the bus, and the three places hanging off it.
  box(BOARD.x, 0, BOARD.w, BOARD_BOTTOM + 1, BOARD.title);
  put(BOARD.x, RULE_Y, `├${"─".repeat(BOARD.w - 2)}┤`, "line");
  put(HUB, BOARD_BOTTOM, "┬", "line");
  put(HUB, BUS - 1, "│", "line");
  const left = BOXES.slack.stem;
  const right = BOXES.github.stem;
  put(left, BUS, `┌${"─".repeat(right - left - 1)}┐`, "line");
  put(HUB, BUS, "┼", "line");
  for (const place of PLACES) {
    const { x, w, title, right: alignRight, stem } = BOXES[place];
    put(stem, BUS + 1, "│", "line");
    box(x, PLACES_Y, w, EVENTS.length + 2, title, alignRight);
    put(stem, PLACES_Y, "┴", "line");
  }

  let labels: { text: string; lit: boolean } | undefined;
  EVENTS.forEach((event, i) => {
    const timing = TIMELINE[i]!;
    if (tick < timing.start) return;
    const tone: Tone = tick < timing.end ? "on" : "ink";
    const row = (place: Place) => put(BOXES[place].x + 2, PLACES_Y + 1 + i, event.rows[place], tone);

    row(event.from);
    const pulse = (path: Point[], start: number): void => {
      const head = tick - start;
      for (let at = Math.max(0, head - TRAIL + 1); at <= head && at < path.length; at++) light(path[at]!);
    };
    pulse(timing.up, timing.start + APPEAR);

    if (tick < timing.board) return;
    put(BOARD.x + 2, i + 1, `#${event.id}`, tone);
    put(BOARD.x + 8, i + 1, event.author, tone);
    put(BOARD.x + 26, i + 1, event.text, tone === "on" ? "on" : "line");
    if (event.labels) labels = { text: event.labels, lit: tick < timing.end };

    for (const down of timing.downs) {
      pulse(down.path, down.start);
      if (tick >= down.arrive) row(down.place);
    }
  });
  put(BOARD.x + 2, LABELS_Y, "labels on #812:", "line");
  if (labels) put(BOARD.x + 18, LABELS_Y, labels.text, labels.lit ? "on" : "ink");
  return grid;
}

function render(tick: number): ReactNode {
  return draw(tick).map((row, y) => {
    const runs: { text: string; tone: Tone }[] = [];
    for (const { char, tone } of row) {
      const last = runs.at(-1);
      if (last?.tone === tone) last.text += char;
      else runs.push({ text: char, tone });
    }
    return (
      <span key={y}>
        {runs.map((run, i) =>
          run.tone === "line" ? (
            run.text
          ) : (
            <span key={i} className={run.tone}>
              {run.text}
            </span>
          ),
        )}
        {"\n"}
      </span>
    );
  });
}

/** One PR's thread, kept in sync between GitHub, a Slack channel, and an agent's terminal. */
export function Diagram(): ReactNode {
  const [tick, setTick] = useState(LOOP - 1);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setTick((current) => (current + 1) % LOOP), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <figure className="diagram">
      <pre aria-hidden>{render(tick)}</pre>
      <figcaption className="sr-only">
        One board thread for pull request 42, synced with GitHub, a Slack channel, and an agent&apos;s terminal.
        Julian opens the PR on GitHub, and it reaches Slack and the agent. Ada asks in Slack whether iOS works too,
        and the question reaches GitHub and the agent. The agent replies that iOS is fixed, and the reply reaches
        Slack and GitHub. Grace approves and Julian merges on GitHub, and the board&apos;s labels for the PR change
        from state=open to review=approved and state=merged. The board logs every event, with its author, in order.
      </figcaption>
    </figure>
  );
}
