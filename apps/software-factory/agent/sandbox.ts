import { defineSandbox } from "eve/sandbox";
import { VercelSandbox } from "eve/sandbox/vercel";
import { BOARD, TOOLS } from "../app/api/board/[[...path]]/harness.ts";
import xinput from "./lib/xinput.py?raw";
import { XINPUT } from "./lib/computer";

// The tools Eve's sandbox gets (vb, gh, the desktop and Chrome), installed once at build into the snapshot every
// thread's sandbox starts from. eve puts the skills in ~/.agents/skills.
export const environment = VercelSandbox.environment({
  prepare: async (sandbox) => {
    const tools = await sandbox.run({ command: `sudo bash -c ${JSON.stringify(TOOLS)}` });
    if (tools.exitCode !== 0) throw new Error(`sandbox setup failed: ${tools.stderr.slice(-500)}`);
    await sandbox.writeTextFile({ path: XINPUT, content: xinput });
    const scripts = await sandbox.run({ command: `chmod +x ${XINPUT} "$HOME"/.agents/skills/*/scripts/*` });
    if (scripts.exitCode !== 0) throw new Error(`sandbox setup failed: ${scripts.stderr.slice(-500)}`);
  },
});

// 6 vCPUs, a 45-minute session that eve resumes on the next turn, and placeholders where credentials
// go. Until the first turn's hook puts the real ones in its policy (`hooks/credentials.ts`), it reaches nothing.
export default defineSandbox(() =>
  environment.open({
    resources: { vcpus: 6 },
    timeout: 45 * 60_000,
    networkPolicy: "deny-all",
    env: {
      AI_GATEWAY_API_KEY: "from-the-network-policy",
      BOARD_URL: BOARD,
      BOARD_TOKEN: "from-the-network-policy",
      GH_TOKEN: "from-the-network-policy",
    },
  }),
);
