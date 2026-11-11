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

for (const method of ["GET", "POST"]) {
  test(`profile: translates a proxied ${method} request without losing its headers, body or cancellation`, async () => {
    const controller = new AbortController();
    const original = new Request("https://board.test/api/board/messages?limit=2", {
      method,
      headers: {
        "x-board-profile": 'fixer;avatar="https://example.com/f.png"',
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      signal: controller.signal,
      ...(method === "POST" ? { body: '{"text":"hi"}' } : {}),
    });
    // Next.js proxies route requests, reading getters and binding methods to the
    // underlying request. The proxy itself has none of Request's private slots.
    const proxied = new Proxy(original, {
      get(target, key) {
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const request = asBoardReadsIt(proxied);
    assert.equal(request.url, "https://board.test/api/board/messages?limit=2");
    assert.equal(request.method, method);
    assert.equal(request.headers.get("x-board-profile"), "fixer");
    assert.equal(request.headers.get("x-board-avatar"), "https://example.com/f.png");
    assert.equal(request.headers.get("authorization"), "Bearer test-token");
    assert.equal(request.headers.get("content-type"), "application/json");
    assert.equal(await request.text(), method === "POST" ? '{"text":"hi"}' : "");
    assert.equal(request.signal.aborted, false);
    controller.abort();
    assert.equal(request.signal.aborted, true);
  });
}
