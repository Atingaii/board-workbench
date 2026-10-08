import type { NextConfig } from "next";

const config: NextConfig = {
  // The skills the board route writes into Pi's sandbox (agent.ts reads them at runtime).
  outputFileTracingIncludes: { "/api/board/[[...path]]": ["./skills/**/*"] },
  // Every docs page as authored, for agents and "copy as markdown": /quickstart.md.
  // The board's routes under /api never are.
  rewrites: async () => [{ source: "/:path((?!api/).+)\\.md", destination: "/raw/:path" }],
};

export default config;
