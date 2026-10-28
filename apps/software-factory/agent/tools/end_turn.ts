import { defineTool } from "eve/tools";
import { noReply } from "eve/tools/no_reply";

// eve's no_reply under a name that fits this Eve: its replies go out through the vb tool and its
// final text reaches nobody, so ending the turn skips only the closing summary, not the reply.
// The tool is named after this file: end_turn.
export default defineTool({
  ...noReply,
  description: `End your turn now, without writing a final message. Your final message reaches nobody: people in the thread see only what you post with the vb tool (vb reply, vb react, vb label). So reply with vb first, then call this as your last step instead of writing a closing summary: right after the vb reply that finishes the work, or when a new message isn't for you and you're staying quiet. Call it alone, not alongside other tools in the same step.`,
  inputSchema: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description: "What you did this turn, or why you stayed quiet. Kept in the session history and traces; never sent.",
      },
    },
    additionalProperties: false,
  },
  execute: () => "Turn ended.",
});
