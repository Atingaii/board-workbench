import { defineSandbox } from "eve/sandbox";
import { VercelSandbox } from "eve/sandbox/vercel";
import { BOARD, TOOLS } from "../app/api/board/[[...path]]/harness.ts";
import xinput from "./lib/xinput.py?raw";
import { XINPUT } from "./lib/computer";

// Tools are installed once, at build, into the snapshot.
export const environment = VercelSandbox.environment({
  prepare: async (sandbox) => {
    const tools = await sandbox.run({ command: `sudo bash -c ${JSON.stringify(TOOLS)}` });
    if (tools.exitCode !== 0) throw new Error(`sandbox setup failed: ${tools.stderr.slice(-500)}`);
    await sandbox.writeTextFile({ path: XINPUT, content: xinput });
    const scripts = await sandbox.run({ command: `chmod +x ${XINPUT} "$HOME"/.agents/skills/*/scripts/*` });
    if (scripts.exitCode !== 0) throw new Error(`sandbox setup failed: ${scripts.stderr.slice(-500)}`);
  },
});

// Credentials are placeholders; hooks/credentials.ts puts the real ones in the network policy.
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
