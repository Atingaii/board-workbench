import assert from "node:assert/strict";
import { test } from "node:test";
import { board } from "@vercel/board";
import { local } from "@vercel/board/backend-local";
import { agentBoard, runVb } from "../agent/lib/vb-tool.ts";

// The agent's vb tool, run as the tool runs it, on a real board kept in memory: what the agent gets
// back is what vb prints, and what lands on the board is what people see.

const noFiles = async () => ({ readBinaryFile: async () => null, writeBinaryFile: async () => {} });

async function factory() {
  const team = board({ backend: local({ memory: true }) });
  const root = await team.post("dev", "the build is red");
  return { team, root, agent: agentBoard(team) };
}

test("a reply through the tool lands on the board as the factory itself, under no profile, whatever the handle it's given names", async () => {
  // On Vercel a handle that says nothing writes under the project's BOARD_PROFILE, when it has one.
  // Here that's a handle that names a profile: the tool's handle must still write under none.
  const { team, root } = await factory();
  const named = team.as("someone-else");
  const printed = await runVb(agentBoard(named), ["reply", String(root.id), "looking into it"], noFiles);
  assert.doesNotMatch(printed, /\(exit/);
  await named.reply(root.id, "as the handle says");
  const { messages } = await team.messages({ channel: "dev" });
  const by = (text: string) => messages.find((message) => message.text === text)?.by;
  // The board itself wrote it: the actor is the board's own, with no profile on it.
  assert.equal(by("looking into it")?.actor, (await team.me()).actor);
  assert.equal(by("looking into it")?.profile, null);
  // The handle the tool was given, to show the profile was there to be taken.
  assert.equal(by("as the handle says")?.actor, `${(await team.me()).actor}:someone-else`);
});

test("the tool runs no command that streams, reads the platforms' raw events, or changes who's let onto the board", async () => {
  const { agent } = await factory();
  for (const command of ["tail", "wait", "inbox", "sources", "grants"]) {
    const printed = await runVb(agent, [command, "dev"], noFiles);
    assert.match(printed, new RegExp(`${command} isn't available here`), command);
    assert.match(printed, /\(exit 2\)/, command);
  }
});
