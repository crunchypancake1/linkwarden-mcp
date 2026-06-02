import { LinkwardenMCP } from "./mcp/agent";
import { runScheduled } from "./indexer/cron";
import { processR2Event } from "./indexer/event";
import type { Env, R2EventNotificationMessage } from "./types";

export { LinkwardenMCP };

export default {
  ...LinkwardenMCP.serve("/mcp", { binding: "LINKWARDEN_MCP" }),
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduled(env));
  },
  async queue(
    batch: MessageBatch<R2EventNotificationMessage>,
    env: Env,
  ): Promise<void> {
    await Promise.all(
      batch.messages.map(async (msg) => {
        try {
          await processR2Event(msg.body.object.key, msg.body.action, env);
          msg.ack();
        } catch (err) {
          console.error(
            `[linkwarden-indexer] Failed to process event for ${msg.body.object.key}:`,
            err,
          );
          msg.retry();
        }
      }),
    );
  },
};
