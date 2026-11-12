import type { NextConfig } from "next";
import { withEve } from "eve/next";

// The agent in agent/ is mounted at /eve/v1, beside the board at /api/board.
const config: NextConfig = {
  // The launcher links to lines of channels.ts, which it finds in the file as deployed (lib/setup.ts).
  outputFileTracingIncludes: { "/*": ["./app/api/board/*/channels.ts"] },
};

export default withEve(config);
