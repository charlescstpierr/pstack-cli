#!/usr/bin/env bun
import { handleCommand } from "./command";

export { defaultConfigPath, handleCommand, UPSTREAM_BUDGET_RECOMMENDATIONS,
  UPSTREAM_MODEL_RECOMMENDATIONS, UPSTREAM_SETUP_SOURCE } from "./command";
export type { CommandDependencies } from "./command";

if (import.meta.main) {
  try {
    const output = await handleCommand(process.argv.slice(2));
    process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
