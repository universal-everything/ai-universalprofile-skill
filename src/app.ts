// Application entry shared by the CLI, the MCP server and the doctor shim.
// Importing ./verbs/index.ts registers every verb.
import "./verbs/index.ts";
export { runCli } from "./cli/main.ts";
export { runMcpServer, handleMcpMessage } from "./mcp/server.ts";
export { allVerbs, inputSchema, mcpToolName, GLOBAL_PARAMS } from "./core/verbs.ts";
