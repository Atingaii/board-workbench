import { defineTool } from "eve/tools";
import { noReply } from "eve/tools/no_reply";

// eve's no_reply, described for an Eve whose answers go out through the vb tool: its final text
// reaches nobody, so a closing message after the last vb reply is only time spent.
export default defineTool({
  ...noReply,
  description: `End your turn now, without writing a final message. Nobody reads your final message: people in the thread see only what you post with the vb tool (vb reply, vb react, vb label). Call this as your last step instead of writing a closing summary: right after the vb reply that finishes the work, or when a new message isn't for you and you're staying quiet. Don't call it in place of a vb reply someone is waiting for, and call it alone, not alongside other tools in the same step.`,
});
