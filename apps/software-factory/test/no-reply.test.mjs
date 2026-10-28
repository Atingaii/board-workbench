import assert from "node:assert/strict";
import { test } from "node:test";
import tool from "../agent/tools/no_reply.ts";

test("no_reply: ends the turn, and its description is for an Eve that answers with vb", async () => {
  assert.equal(tool.endsTurn, true);
  assert.equal(tool.availableInSubagents, false);
  assert.match(tool.description, /vb reply/);
  assert.match(tool.description, /Nobody reads your final message/);
  assert.equal(await tool.execute({ reason: "replied with vb" }, {}), "No reply was sent.");
});
