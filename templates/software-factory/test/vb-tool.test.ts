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

test("the tool runs no command that streams, reads outside the board's channels, or acts on the board itself", async () => {
  const { agent } = await factory();
  for (const command of ["tail", "wait", "sources", "inbox", "tokens", "grants", "schemas", "hooks", "conformance"]) {
    const printed = await runVb(agent, [command], noFiles);
    assert.match(printed, new RegExp(`${command} isn't available here`), command);
    assert.match(printed, /\(exit 2\)/, command);
  }
});

test("the agent can't write as another profile: --as and --avatar are refused, and nothing is posted", async () => {
  const { team, root, agent } = await factory();
  for (const flag of [["--as", "wake"], ["--as=wake"], ["--avatar", "https://example.com/a.png"]]) {
    const printed = await runVb(agent, ["reply", String(root.id), "as someone else", ...flag], noFiles);
    assert.match(printed, /--as and --avatar aren't available here: you write as factory/);
  }
  const { messages } = await team.messages({ channel: "dev" });
  assert.equal(messages.some((message) => message.text === "as someone else"), false);
});

test("text that says --as, after --, is only text", async () => {
  const { team, root, agent } = await factory();
  await runVb(agent, ["reply", String(root.id), "--", "--as"], noFiles);
  const { messages } = await team.messages({ channel: "dev" });
  assert.equal(messages.some((message) => message.text === "--as"), true);
});
