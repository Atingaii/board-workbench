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

test("a reply through the tool lands on the board under the agent's profile", async () => {
  const { team, root, agent } = await factory();
  const printed = await runVb(agent, ["reply", String(root.id), "looking into it"], noFiles);
  assert.doesNotMatch(printed, /\(exit/);
  const { messages } = await team.messages({ channel: "dev" });
  const reply = messages.find((message) => message.text === "looking into it");
  assert.equal(reply?.by.actor, "board:client:factory");
});

test("the tool runs no command that streams, reads the platforms' raw events, or changes who's let onto the board", async () => {
  const { agent } = await factory();
  for (const command of ["tail", "wait", "inbox", "sources", "grants"]) {
    const printed = await runVb(agent, [command, "dev"], noFiles);
    assert.match(printed, new RegExp(`${command} isn't available here`), command);
    assert.match(printed, /\(exit 2\)/, command);
  }
});
