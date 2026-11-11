import assert from "node:assert/strict";
import { test } from "node:test";
import { asBoardReadsIt, profileHeader } from "../app/api/board/[[...path]]/profile.ts";

const read = (value) => {
  const request = asBoardReadsIt(new Request("https://board.test/api/board/messages", { method: "POST", headers: { "x-board-profile": value }, body: "{}" }));
  return [request.headers.get("x-board-profile"), request.headers.get("x-board-avatar")];
};

test("profile: the factory's board reads a profile header's avatar as the avatar header it knows", async () => {
  assert.deepEqual(read('clever-lemur-1956;avatar="https://example.com/lemur.png"'), ["clever-lemur-1956", "https://example.com/lemur.png"]);
  assert.deepEqual(read('fixer; avatar="https://example.com/a\\"b.png"'), ["fixer", 'https://example.com/a"b.png']);
  assert.deepEqual(read(profileHeader("fixer", 'https://example.com/a"b.png')), ["fixer", 'https://example.com/a"b.png']);
  // A name alone, or a header it doesn't know, goes to the board as it is.
  assert.deepEqual(read("fixer"), ["fixer", null]);
  assert.deepEqual(read('fixer;size=2'), ["fixer;size=2", null]);
  const request = asBoardReadsIt(new Request("https://board.test/api/board/messages", { method: "POST", headers: { "x-board-profile": profileHeader("fixer", "https://example.com/f.png") }, body: '{"text":"hi"}' }));
  assert.equal(await request.text(), '{"text":"hi"}');
});
