import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  // ffmpeg -i <clip> reads a 0.2 s clip; an encode's output is as big as FAKE_SIZE says (the last argument is the file).
  fake("ffmpeg", `[ "$1" = -hide_banner ] && { echo "  Duration: 00:00:00.20, start: 0.000000" >&2; exit 1; }
echo "$@" >> "${dir}/ffmpeg.log"; head -c "\${FAKE_SIZE:-1000}" /dev/zero > "\${@: -1}"`);
  // AI Gateway's speech model: logs each request, and answers with "mp3" bytes unless FAKE_TTS=fail.
  fake("curl", `echo "$@" >> "${dir}/curl.log"; [ "$FAKE_TTS" = fail ] && exit 22; echo '{"audio":"bXAz"}'`);
  const PATH = `${bin}:${execFileSync("bash", ["-c", "echo $PATH"], { encoding: "utf8" }).trim()}`;
  const run = (args, env = {}) =>
    spawnSync(script, args, { env: { PATH, UI_VIDEO_DIR: join(dir, "work"), AI_GATEWAY_API_KEY: "g", ...env }, encoding: "utf8" });
  return { dir, run };
}

test("ui-video: each step's caption shows until the next, and the last until stop", () => {
  const { dir, run } = recorder();
  assert.equal(run(["start", "--mute"]).status, 0);
  assert.equal(run(["step", "Signing in"]).status, 0);
  execFileSync("sleep", ["1"]);
  assert.equal(run(["step", 'Posting "hello"']).status, 0);
  execFileSync("sleep", ["1"]);
  const done = run(["stop", join(dir, "out.mp4")]);
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /out\.mp4: 1 KB, 2 captions, 0 narrated, 2s/);

  const srt = readFileSync(join(dir, "work/captions.srt"), "utf8");
  const cues = [...srt.matchAll(/(\d+)\n(\S+) --> (\S+)\n(.+)\n/g)].map((m) => m.slice(1));
  assert.deepEqual(cues.map((c) => [c[0], c[3]]), [["1", "Signing in"], ["2", 'Posting "hello"']]);
  const secs = (t) => { const [h, m, s] = t.replace(",", ".").split(":"); return +h * 3600 + +m * 60 + +s; };
  assert.equal(cues[0][2], cues[1][1], "a caption ends when the next starts");
  assert.ok(Math.abs(secs(cues[1][1]) - secs(cues[0][1]) - 1) < 0.3, "the second caption starts a second in");
  assert.ok(secs(cues[1][2]) - secs(cues[1][1]) >= 0.9, "the last one lasts until stop");

  assert.match(readFileSync(join(dir, "browser.log"), "utf8"), /^record start .*raw\.webm --cursor --fps 15\nrecord stop\n$/);
  const encode = readFileSync(join(dir, "ffmpeg.log"), "utf8");
  assert.match(encode, /subtitles=.*captions\.srt/);
  assert.match(encode, / -an /, "a muted take has no sound");
  assert.ok(!existsSync(join(dir, "curl.log")), "and asks for no voice");
});

test("ui-video: each caption is read aloud from AI Gateway, from when its step starts", () => {
  const { dir, run } = recorder();
  run(["start"]);
  const t0 = Date.now();
  assert.equal(run(["step", "Signing in"]).status, 0);
  assert.ok(Date.now() - t0 >= 200, "a step waits until its line has been said");
  execFileSync("sleep", ["1"]);
  run(["step", 'Posting "hello"']);
  const done = run(["stop", join(dir, "out.mp4")]);
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /2 captions, 2 narrated/);

  const asks = readFileSync(join(dir, "curl.log"), "utf8").trim().split("\n");
  assert.equal(asks.length, 2);
  assert.match(asks[0], /ai-gateway\.vercel\.sh\/v3\/ai\/speech-model .*ai-model-id: openai\/tts-1/);
  assert.match(asks[0], /Authorization: Bearer g/);
  assert.match(asks[1], /"text":"Posting \\"hello\\"","voice":"nova","outputFormat":"mp3"/);
  assert.equal(readFileSync(join(dir, "work/voice-1.mp3"), "utf8"), "mp3");

  const starts = readFileSync(join(dir, "work/steps.tsv"), "utf8").trim().split("\n").map((l) => Math.round(+l.split("\t")[0] * 1000));
  const encode = readFileSync(join(dir, "ffmpeg.log"), "utf8");
  assert.match(encode, /-i \S+voice-1\.mp3 -i \S+voice-2\.mp3/);
  assert.match(encode, new RegExp(`\\[1:a\\]adelay=${starts[0]}:all=1\\[v1\\];\\[2:a\\]adelay=${starts[1]}:all=1\\[v2\\];\\[v1\\]\\[v2\\]amix=inputs=2`));
  assert.match(encode, /-map 0:v -map \[a\] -c:a aac/);
});

test("ui-video: a line the voice model can't say is captioned only, and the take still works", () => {
  const { dir, run } = recorder();
  run(["start"]);
  const step = run(["step", "Signing in"], { FAKE_TTS: "fail" });
  assert.equal(step.status, 0);
  assert.match(step.stderr, /couldn't narrate "Signing in": it's captioned only/);
  const done = run(["stop", join(dir, "out.mp4")]);
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /1 captions, 0 narrated/);
  assert.match(readFileSync(join(dir, "ffmpeg.log"), "utf8"), / -an /);
});

test("ui-video: UI_VIDEO_VOICE=off mutes it, and the model and voice can be picked", () => {
  const off = recorder();
  off.run(["start"], { UI_VIDEO_VOICE: "off" });
  off.run(["step", "Signing in"]);
  assert.ok(!existsSync(join(off.dir, "curl.log")));

  const { dir, run } = recorder();
  const env = { UI_VIDEO_VOICE_MODEL: "spacexai/grok-tts", UI_VIDEO_VOICE: "eve" };
  run(["start"], env);
  run(["step", "Signing in"], env);
  const ask = readFileSync(join(dir, "curl.log"), "utf8");
  assert.match(ask, /ai-model-id: spacexai\/grok-tts/);
  assert.match(ask, /"voice":"eve"/);
});

test("ui-video: a take too big for the board is shrunk, then refused", () => {
  const { dir, run } = recorder();
  run(["start", "--mute"]);
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
