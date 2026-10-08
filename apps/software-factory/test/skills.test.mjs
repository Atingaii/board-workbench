import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { piPreview, policy, skills } from "../app/api/board/[[...path]]/agent.ts";

const root = fileURLToPath(new URL("../skills", import.meta.url));
const script = join(root, "ui-video/scripts/ui-video");
const tokens = { gateway: "g", board: "b", github: "h" };

test("skills: the ui-video skill goes in Pi's skills, its script executable", async () => {
  const files = await skills(root);
  assert.deepEqual(
    files.map((f) => [f.path, f.mode]),
    [
      ["/home/vercel-sandbox/.pi/agent/skills/ui-video/SKILL.md", 0o644],
      ["/home/vercel-sandbox/.pi/agent/skills/ui-video/scripts/ui-video", 0o755],
    ],
  );
  assert.match(String(files[0].content), /^---\nname: ui-video\ndescription: .+\n---\n/);
});

test("policy: Pi's own branch preview gets past Vercel Authentication, and no other deployment sees the secret", () => {
  const allow = policy(3100, tokens, "s3cret").allow;
  assert.equal(piPreview(3100), "vboard-factory-git-pi-3100.playground-vercel.tools");
  assert.deepEqual(allow[piPreview(3100)], [{ transform: [{ headers: { "x-vercel-protection-bypass": "s3cret" } }] }]);
  const withSecret = Object.entries(allow).filter(([, rules]) => JSON.stringify(rules).includes("s3cret"));
  assert.deepEqual(withSecret.map(([host]) => host).sort(), ["vboard-factory.playground-vercel.tools", piPreview(3100)].sort());
  assert.deepEqual(allow["*"], []);
  assert.equal(policy(3100, tokens, undefined).allow[piPreview(3100)], undefined);
});

// ui-video with fake agent-browser and ffmpeg: which captions it burns in, and when.
function recorder() {
  const dir = mkdtempSync(join(tmpdir(), "ui-video-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const fake = (name, body) => {
    writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  fake("agent-browser", `echo "$@" >> "${dir}/browser.log"`);
  // ffmpeg's output is as big as FAKE_SIZE says; the last argument is the file.
  fake("ffmpeg", `echo "$@" >> "${dir}/ffmpeg.log"; head -c "\${FAKE_SIZE:-1000}" /dev/zero > "\${@: -1}"`);
  const PATH = `${bin}:${execFileSync("bash", ["-c", "echo $PATH"], { encoding: "utf8" }).trim()}`;
  const run = (args, env = {}) =>
    spawnSync(script, args, { env: { PATH, UI_VIDEO_DIR: join(dir, "work"), ...env }, encoding: "utf8" });
  return { dir, run };
}

test("ui-video: each step's caption shows until the next, and the last until stop", () => {
  const { dir, run } = recorder();
  assert.equal(run(["start"]).status, 0);
  assert.equal(run(["step", "Signing in"]).status, 0);
  execFileSync("sleep", ["1"]);
  assert.equal(run(["step", 'Posting "hello"']).status, 0);
  execFileSync("sleep", ["1"]);
  const done = run(["stop", join(dir, "out.mp4")]);
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /out\.mp4: 1 KB, 2 captions, 2s/);

  const srt = readFileSync(join(dir, "work/captions.srt"), "utf8");
  const cues = [...srt.matchAll(/(\d+)\n(\S+) --> (\S+)\n(.+)\n/g)].map((m) => m.slice(1));
  assert.deepEqual(cues.map((c) => [c[0], c[3]]), [["1", "Signing in"], ["2", 'Posting "hello"']]);
  const secs = (t) => { const [h, m, s] = t.replace(",", ".").split(":"); return +h * 3600 + +m * 60 + +s; };
  assert.equal(cues[0][2], cues[1][1], "a caption ends when the next starts");
  assert.ok(Math.abs(secs(cues[1][1]) - secs(cues[0][1]) - 1) < 0.3, "the second caption starts a second in");
  assert.ok(secs(cues[1][2]) - secs(cues[1][1]) >= 0.9, "the last one lasts until stop");

  assert.match(readFileSync(join(dir, "browser.log"), "utf8"), /^record start .*raw\.webm --cursor --fps 15\nrecord stop\n$/);
  assert.match(readFileSync(join(dir, "ffmpeg.log"), "utf8"), /subtitles=.*captions\.srt/);
});

test("ui-video: a take too big for the board is shrunk, then refused", () => {
  const { dir, run } = recorder();
  run(["start"]);
  run(["step", "Opening the page"]);
  const tooBig = run(["stop", join(dir, "out.mp4")], { FAKE_SIZE: String(5_000_000) });
  assert.equal(tooBig.status, 1);
  assert.match(tooBig.stderr, /still over 4 MB .* record a shorter take/);
  assert.equal(readFileSync(join(dir, "ffmpeg.log"), "utf8").trim().split("\n").length, 4, "it tries smaller encodes first");
});

test("ui-video: steps need a recording", () => {
  const { run } = recorder();
  const done = run(["step", "Opening the page"]);
  assert.equal(done.status, 1);
  assert.match(done.stderr, /not recording/);
});
