import { LinkwardenMCP } from "./mcp/agent";
import { runScheduled } from "./indexer/cron";
import type { Env } from "./types";

export { LinkwardenMCP };

export default {
  fetch: LinkwardenMCP.mount("/mcp"),
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduled(env));
  },
};
