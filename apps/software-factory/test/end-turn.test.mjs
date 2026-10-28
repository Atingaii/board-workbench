import assert from "node:assert/strict";
import { test } from "node:test";
import tool from "../agent/tools/end_turn.ts";

test("end_turn: ends the turn, and its description is for an Eve that replies with vb", async () => {
  assert.equal(tool.endsTurn, true);
  assert.equal(tool.availableInSubagents, false);
  assert.match(tool.description, /vb reply/);
  assert.match(tool.description, /Your final message reaches nobody/);
  assert.doesNotMatch(JSON.stringify(tool), /no reply/i);
  assert.equal(await tool.execute({}, {}), "Turn ended.");
});

test("end_turn: takes no arguments", () => {
  assert.deepEqual(tool.inputSchema, { type: "object", properties: {}, additionalProperties: false });
});
