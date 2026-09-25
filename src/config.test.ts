import { describe, expect, test } from "bun:test";

import {
  ConfigError,
  detectInstalledAgents,
  loadConfig,
  modelArgs,
  parseConfig,
  resolveRole,
} from "./config";

const configuredRoles = JSON.stringify({
  roles: {
    "feature, refactoring": { kind: "claude", model: "sonnet" },
    "judgment and prose": { kind: "codex", model: "gpt-5.4" },
    "how explorer": { kind: "opencode", model: "openai/gpt-5" },
    "why synthesizer": { kind: "pi", model: "anthropic/sonnet" },
  },
});

describe("configuration parsing", () => {
  test("preserves explicit role kind and model selections", () => {
    expect(parseConfig(configuredRoles)).toEqual({
      roles: {
        "feature, refactoring": { kind: "claude", model: "sonnet" },
        "judgment and prose": { kind: "codex", model: "gpt-5.4" },
        "how explorer": { kind: "opencode", model: "openai/gpt-5" },
        "why synthesizer": { kind: "pi", model: "anthropic/sonnet" },
      },
    });
  });

  test("preserves a separate master selection without changing worker roles", () => {
    const configured = parseConfig(JSON.stringify({
      roles: { "bug-fix": { kind: "codex", model: "gpt-6-sol" } },
      master: { kind: "opencode", model: "openai/gpt-6-sol" },
    }));
    expect(configured.master).toEqual({ kind: "opencode", model: "openai/gpt-6-sol" });
    expect(configured.roles["bug-fix"]).toEqual({ kind: "codex", model: "gpt-6-sol" });
    expect(() => parseConfig(JSON.stringify({ roles: {}, master: { kind: "cursor", model: "x" } })))
      .toThrow(/unsupported kind/);
  });

  test("rejects invalid JSON, role names, kinds, and models", () => {
    expect(() => parseConfig("not json")).toThrow(ConfigError);
    expect(() => parseConfig(JSON.stringify({ roles: { unknown: { kind: "claude", model: "sonnet" } } }))).toThrow(/Unknown upstream role/);
    expect(() => parseConfig(JSON.stringify({ roles: { "bug-fix": { kind: "cursor", model: "x" } } }))).toThrow(/unsupported kind/);
    expect(() => parseConfig(JSON.stringify({ roles: { "bug-fix": { kind: "claude", model: "  " } } }))).toThrow(/non-empty model/);
  });

  test("loads JSON through an injected user-path reader", async () => {
    const readPaths: string[] = [];
    const config = await loadConfig("/home/tester/.config/pstack-cli/models.json", async (path) => {
      readPaths.push(path);
      return configuredRoles;
    });
    expect(readPaths).toEqual(["/home/tester/.config/pstack-cli/models.json"]);
    expect(config.roles["how explorer"]).toEqual({ kind: "opencode", model: "openai/gpt-5" });
  });
});

describe("agent discovery and role resolution", () => {
  test("detects every installed supported CLI through an injected lookup", () => {
    const lookedUp: string[] = [];
    const installed = detectInstalledAgents((executable) => {
      lookedUp.push(executable);
      return executable === "claude" || executable === "opencode" ? `/bin/${executable}` : null;
    });
    expect(lookedUp).toEqual(["claude", "codex", "opencode", "pi"]);
    expect(installed).toEqual(["claude", "opencode"]);
  });

  test("resolves the explicitly selected available CLI and its native model flag", () => {
    const config = parseConfig(configuredRoles);
    expect(resolveRole(config, "judgment and prose", ["claude", "codex"])).toEqual({
      role: "judgment and prose",
      kind: "codex",
      model: "gpt-5.4",
      executable: "codex",
      modelArgs: ["-m", "gpt-5.4"],
    });
    expect(resolveRole(config, "why synthesizer", ["pi"])).toMatchObject({
      kind: "pi",
      model: "anthropic/sonnet",
      modelArgs: ["--model", "anthropic/sonnet"],
    });
  });

  test("does not replace an explicitly selected unavailable CLI", () => {
    expect(() => resolveRole(parseConfig(configuredRoles), "how explorer", ["claude", "codex"])).toThrow(/unavailable CLI/);
  });

  test("uses the documented model flags for each CLI", () => {
    expect(modelArgs("claude", "sonnet")).toEqual(["--model", "sonnet"]);
    expect(modelArgs("pi", "sonnet")).toEqual(["--model", "sonnet"]);
    expect(modelArgs("codex", "gpt-5.4")).toEqual(["-m", "gpt-5.4"]);
    expect(modelArgs("opencode", "openai/gpt-5")).toEqual(["-m", "openai/gpt-5"]);
  });
});
