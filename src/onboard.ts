#!/usr/bin/env bun
import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { createInterface } from "node:readline/promises";
import { AGENT_KINDS, UPSTREAM_ROLE_NAMES } from "./config";
import type { AgentKind, RoleName } from "./config";
import { handleCommand, UPSTREAM_MODEL_RECOMMENDATIONS } from "./command";

export interface OnboardingIO {
  readonly ask: (question: string) => Promise<string>;
  readonly print: (message: string) => void;
  readonly execute?: (argv: string[]) => Promise<string>;
  readonly configPath?: string;
}

async function choose<T extends string>(entries: readonly T[], question: string, io: OnboardingIO): Promise<T> {
  io.print(entries.map((entry, index) => `${index + 1}. ${entry}`).join("\n"));
  while (true) {
    const answer = (await io.ask(question)).trim();
    const index = Number(answer);
    const selected = Number.isInteger(index) && index >= 1 ? entries[index - 1] : undefined;
    if (selected) return selected;
    io.print(`Choisis un numéro entre 1 et ${entries.length}.`);
  }
}

async function chooseMany<T extends string>(entries: readonly T[], io: OnboardingIO): Promise<T[]> {
  io.print(entries.map((entry, index) => `${index + 1}. ${entry}`).join("\n"));
  while (true) {
    const parts = (await io.ask("Numéros des CLI (ex. 1,3) : ")).split(",").map((part) => part.trim());
    const indexes = parts.map(Number);
    if (parts.length > 0 && parts.every((part) => /^[1-9]\d*$/.test(part)) &&
        indexes.every((index) => index <= entries.length) && new Set(indexes).size === indexes.length) {
      return indexes.map((index) => entries[index - 1]).filter((entry): entry is T => entry !== undefined);
    }
    io.print(`Choisis un ou plusieurs numéros distincts entre 1 et ${entries.length}, séparés par des virgules.`);
  }
}

async function required(question: string, io: OnboardingIO): Promise<string> {
  while (true) {
    const value = (await io.ask(question)).trim();
    if (value) return value;
    io.print("Une réponse est nécessaire.");
  }
}

export async function runOnboarding(io: OnboardingIO): Promise<void> {
  const execute = io.execute ?? handleCommand;
  const withConfig = (argv: string[]) => io.configPath ? [...argv, "--config", io.configPath] : argv;

  io.print("Bienvenue dans Pstack CLI. Voici les recommandations officielles et tes choix actuels :");
  io.print(await execute(withConfig(["setup"])));
  const detected = (await execute(["detect"])).split("\n");
  const installed = AGENT_KINDS.filter((kind) => detected.includes(kind));
  if (!installed.length) {
    io.print("Aucune CLI détectée. Installe et connecte Claude Code, Codex, OpenCode ou Pi, puis relance l'onboarding.");
    return;
  }

  io.print("\nQuelles CLI veux-tu configurer ? Une même session peut en configurer plusieurs.");
  const selected = await chooseMany(installed, io);
  const configured: Array<{ readonly role: RoleName; readonly kind: AgentKind }> = [];
  for (const kind of selected) {
    io.print(`\nQuel rôle veux-tu attribuer à ${kind} ? Chaque rôle a une seule CLI.`);
    const available = UPSTREAM_ROLE_NAMES.filter((role) => !configured.some((item) => item.role === role));
    const role = await choose(available, "Numéro du rôle : ", io);
    io.print(`Recommandation Lauren Tan pour ${role} : ${UPSTREAM_MODEL_RECOMMENDATIONS[role].join(", ")} (modèles Cursor, à adapter pour ${kind}).`);
    const model = await required(`Modèle accepté par ${kind} (l'accès n'est pas vérifié) : `, io);
    await execute(withConfig(["setup", "--role", role, "--kind", kind, "--model", model]));
    configured.push({ role, kind });
    io.print(`Rôle enregistré : ${role} -> ${kind} ${model}.`);
  }

  const launch = (await io.ask("Lancer un premier agent maintenant ? (o/N) : ")).trim().toLowerCase();
  if (launch !== "o" && launch !== "oui") {
    io.print('Terminé. Pour la suite : pstack-cli status, read NOM ou resume NOM --prompt "Suite".');
    return;
  }

  const role = configured.length === 1
    ? configured[0].role
    : await choose(configured.map((item) => item.role), "Numéro du rôle à lancer : ", io);
  let cwd: string;
  while (true) {
    cwd = await required("Chemin absolu du dossier où l'agent travaillera : ", io);
    if (isAbsolute(cwd) && existsSync(cwd) && statSync(cwd).isDirectory()) break;
    io.print("Donne le chemin absolu d'un dossier existant.");
  }
  const prompt = await required("Que doit faire l'agent ? ", io);
  io.print(await execute(withConfig(["run", "--role", role, "--cwd", cwd, "--prompt", prompt])));
  io.print("L'agent reste dans son propre workspace Herdr. Note son nom pstack-... pour reprendre son travail.");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === "--help" || args[0] === "help")) {
    console.log("Usage: pstack-init [--config PATH]\nGuide interactif pour choisir une CLI, un rôle, un modèle et lancer un premier agent.");
  } else if (args.length !== 0 && (args.length !== 2 || args[0] !== "--config" || !args[1])) {
    console.error("Usage: pstack-init [--config PATH]");
    process.exitCode = 1;
  } else {
    const input = createInterface({ input: process.stdin, output: process.stdout });
    try {
      await runOnboarding({
        ask: async (question) => {
          const answer = await input.question(question);
          process.stdout.write("\r\n");
          return answer;
        },
        print: (message) => process.stdout.write(`${message.replace(/\r?\n/g, "\r\n")}\r\n`),
        ...(args[1] ? { configPath: args[1] } : {}),
      });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      input.close();
    }
  }
}
