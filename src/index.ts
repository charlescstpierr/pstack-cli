#!/usr/bin/env bun
import { handleCommand } from "./command";
import { attachMasterTerminal } from "./master";

export { defaultConfigPath, handleCommand, UPSTREAM_BUDGET_RECOMMENDATIONS,
  UPSTREAM_MODEL_RECOMMENDATIONS, UPSTREAM_SETUP_SOURCE } from "./command";
export type { CommandDependencies } from "./command";

if (import.meta.main) {
  try {
    const output = await handleCommand(process.argv.slice(2));
    process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
    if (process.argv[2] === "chat" && !output.endsWith("status=stopped") &&
        process.stdin.isTTY && process.stdout.isTTY && !process.env.HERDR_ENV) {
      const name = output.split(" ", 1)[0];
      if (name) {
        process.stdout.write("Quitter le terminal direct avec ctrl+b puis q ; la conversation reste dans Herdr.\n");
        process.exitCode = await attachMasterTerminal(name);
      }
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
