import type { NextConfig } from "next";
import { withEve } from "eve/next";

const config: NextConfig = {
  // The skills and extensions the board route writes into Pi's sandbox (agent.ts reads them at runtime).
  outputFileTracingIncludes: { "/api/board/[[...path]]": ["./skills/**/*", "./extensions/**/*"] },
  // Every docs page as authored, for agents and "copy as markdown": /quickstart.md.
  // The board's routes under /api never are.
  rewrites: async () => [{ source: "/:path((?!api/).+)\\.md", destination: "/raw/:path" }],
};

// The eve agent in `agent/`, at /eve/v1: threads FACTORY_EVE_FROM gives it (`eve.ts` beside the board route).
export default withEve(config);
