import { disableTool } from "eve/tools";

// No subagents: one would get a sandbox of its own, without the thread's credentials.
export default disableTool();
