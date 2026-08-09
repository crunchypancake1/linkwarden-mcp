import { LinkwardenMCP } from "./mcp/agent";

export { LinkwardenMCP };

export default {
  ...LinkwardenMCP.serve("/mcp", { binding: "LINKWARDEN_MCP" }),
};
