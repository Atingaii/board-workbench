import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { TELL } from "../app/api/board/[[...path]]/agent.ts";

// A sandbox home with a fake `pi` that records each turn it's asked to run.
function sandbox() {
  const home = mkdtempSync(join(tmpdir(), "tell-"));
  mkdirSync(join(home, "bin"));
  mkdirSync(join(home, ".pi"));
  writeFileSync(join(home, "bin", "pi"), `#!/bin/bash\necho "$KEY" >> "$HOME/turns"\n`);
  chmodSync(join(home, "bin", "pi"), 0o755);
  const tell = (key) =>
    new Promise((resolve, reject) => {
      const child = spawn("bash", ["-c", TELL], {
        env: { HOME: home, PATH: `${home}/bin:${process.env.PATH}`, KEY: key, MODEL: "m", SESSION: "s", INSTRUCTIONS: "i", MESSAGE: "There's new activity." },
      });
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
    });
  const turns = () => (existsSync(join(home, "turns")) ? readFileSync(join(home, "turns"), "utf8").trim().split("\n") : []);
  // A turn that's still running: holds Pi's lock until released.
  const busy = () => {
    const gate = join(home, "gate");
    writeFileSync(gate, "");
    const holder = spawn("flock", [join(home, ".pi", "lock"), "bash", "-c", `while [ -e ${gate} ]; do sleep 0.05; done`]);
    execFileSync("bash", ["-c", "sleep 0.2"]);
    return () => new Promise((resolve) => { holder.on("exit", resolve); execFileSync("rm", [gate]); });
  };
  return { tell, turns, busy };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("replies that pile up behind a running turn wake Pi once, not once each", async () => {
  const { tell, turns, busy } = sandbox();
  const release = busy();
  const queued = [];
  for (const key of ["news-1174", "news-1175", "news-1179", "news-1184"]) {
    queued.push(tell(key));
    await sleep(100);
  }
  await release();
  await Promise.all(queued);
  // Pi reads everything new itself, so the newest wake-up covers the ones before it.
  assert.deepEqual(turns(), ["news-1184"]);
});

test("tasks (a kind, a shipit, a review) are never dropped, even behind a turn", async () => {
  const { tell, turns, busy } = sandbox();
  const release = busy();
  const queued = [];
  for (const key of ["kind-bug", "news-1", "shipit-9", "news-2"]) {
    queued.push(tell(key));
    await sleep(100);
  }
  await release();
  await Promise.all(queued);
  assert.deepEqual(turns().sort(), ["kind-bug", "news-2", "shipit-9"]);
});

test("a message is still delivered once: a retried watcher is a no-op", async () => {
  const { tell, turns } = sandbox();
  await tell("news-1");
  await tell("news-1");
  await tell("news-2");
  assert.deepEqual(turns(), ["news-1", "news-2"]);
});
