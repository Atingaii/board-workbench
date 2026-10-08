import type { NextConfig } from "next";

const config: NextConfig = {
  // Every docs page as authored, for agents and "copy as markdown": /quickstart.md.
  // The board's routes under /api never are.
  rewrites: async () => [{ source: "/:path((?!api/).+)\\.md", destination: "/raw/:path" }],
};

export default config;
