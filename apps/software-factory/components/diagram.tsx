"use client";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

type Tone = "line" | "ink" | "on";
type Cell = { char: string; tone: Tone };
type Side = "slack" | "terminal";

/** One thread: ada writes in Slack, an agent answers from a terminal, and the board logs it all. */
const EVENTS: { id: number; from: Side; who: string; text: string }[] = [
  { id: 812, from: "slack", who: "ada", text: "build failed" },
  { id: 813, from: "terminal", who: "claude", text: "on it" },
  { id: 815, from: "terminal", who: "claude", text: "rolled back" },
  { id: 816, from: "slack", who: "ada", text: "thanks!" },
];

/** How each place shows a message: Slack by name, the CLI by ID, the board with its author. */
const rows = {
  slack: (event: (typeof EVENTS)[number]) => `${event.who.padEnd(8)}${event.text}`,
  terminal: (event: (typeof EVENTS)[number]) => `#${event.id} ${event.who.padEnd(7)}${event.text}`,
};
const author = (event: (typeof EVENTS)[number]) =>
  event.from === "slack" ? `${event.who} (slack)` : `${event.who} via julian`;

const BOX = 28;
const GAP = 10;
const WIDTH = BOX * 2 + GAP;
/** The arrow between the two places fills the gap, one space clear of each box. */
const ARROW = GAP - 2;

const BOARD_X = 11;
const BOARD_WIDTH = 46;
/** Where the board's two stems drop into each place's top border, just past its title. */
const STEMS = [14, 53] as const;
const LOG_Y = EVENTS.length + 3;
const HEIGHT = LOG_Y + EVENTS.length + 2;

// In ticks: a message shows where it was written, crosses the wire, then settles.
const APPEAR = 2;
const SETTLE = 4;
const PER_EVENT = APPEAR + ARROW + SETTLE;
const LOOP = EVENTS.length * PER_EVENT + 14;
const TICK_MS = 70;

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
  const box = (x: number, y: number, w: number, h: number, title: string): void => {
    put(x, y, `┌─ ${title} ${"─".repeat(w - title.length - 5)}┐`, "line");
    for (let row = y + 1; row < y + h - 1; row++) {
      put(x, row, "│", "line");
      put(x + w - 1, row, "│", "line");
    }
    put(x, y + h - 1, `└${"─".repeat(w - 2)}┘`, "line");
  };

  box(BOARD_X, 0, BOARD_WIDTH, EVENTS.length + 2, "board");
  for (const x of STEMS) {
    put(x, EVENTS.length + 1, "┬", "line");
    put(x, EVENTS.length + 2, "│", "line");
  }
  box(0, LOG_Y, BOX, EVENTS.length + 2, "slack #dev");
  box(BOX + GAP, LOG_Y, BOX, EVENTS.length + 2, "vb tail dev");
  for (const x of STEMS) put(x, LOG_Y, "┴", "line");

  EVENTS.forEach((event, i) => {
    const t = tick - i * PER_EVENT;
    if (t < 0) return;
    const tone: Tone = t < PER_EVENT ? "on" : "ink";
    put(BOARD_X + 2, i + 1, `#${event.id}`, tone);
    put(BOARD_X + 8, i + 1, author(event), tone);
    put(BOARD_X + 28, i + 1, event.text, tone === "on" ? "on" : "line");

    const y = LOG_Y + i + 1;
    const rightward = event.from === "slack";
    const to: Side = rightward ? "terminal" : "slack";
    put(rightward ? 2 : BOX + GAP + 2, y, rows[event.from](event), tone);

    const travelled = Math.min(Math.max(t - APPEAR + 1, 0), ARROW);
    if (!travelled) return;
    const arrived = travelled === ARROW;
    const shaft = "─".repeat(travelled - 1);
    const arrow = arrived ? "line" : "on";
    if (rightward) put(BOX + 1, y, `${shaft}▶`, arrow);
    else put(BOX + GAP - 1 - travelled, y, `◀${shaft}`, arrow);
    if (arrived) put(rightward ? BOX + GAP + 2 : 2, y, rows[to](event), tone);
  });
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

/** One board thread, kept in sync between a Slack channel and an agent's terminal. */
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
        A board thread synced with a Slack channel and an agent running vb tail in a terminal. Ada posts
        &quot;build failed&quot; in Slack and it reaches the terminal as message 812; the agent replies from the
        terminal and its replies reach Slack. The board logs every message, with its author, in order.
      </figcaption>
    </figure>
  );
}
