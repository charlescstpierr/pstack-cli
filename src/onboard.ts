#!/usr/bin/env bun
import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { createInterface } from "node:readline/promises";
import { AGENT_KINDS, UPSTREAM_ROLE_NAMES } from "./config";
import type { AgentKind, RoleName } from "./config";
import { handleCommand, UPSTREAM_MODEL_RECOMMENDATIONS } from "./command";
import { attachMasterTerminal } from "./master";

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

export async function runOnboarding(io: OnboardingIO): Promise<string | undefined> {
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

  io.print("\nAvec quelle CLI veux-tu me parler ? Elle sera l'agent maître de la conversation.");
  const masterKind = await choose(installed, "Numéro de la CLI maîtresse : ", io);
  io.print(`Recommandation Lauren Tan pour le jugement et la synthèse : ${UPSTREAM_MODEL_RECOMMENDATIONS["judgment and prose"].join(", ")} (modèle Cursor, à adapter pour ${masterKind}).`);
  const masterModel = await required(`Modèle de la conversation accepté par ${masterKind} : `, io);
  await execute(withConfig(["setup", "--master", masterKind, "--model", masterModel]));
  io.print(`Conversation principale : ${masterKind} ${masterModel}.`);

  io.print("\nQuelles CLI veux-tu configurer pour les rôles workers ? Une même session peut en configurer plusieurs.");
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

  const launch = (await io.ask("Ouvrir ta conversation avec l'agent maître maintenant ? (o/N) : ")).trim().toLowerCase();
  if (launch !== "o" && launch !== "oui") {
    io.print('Terminé. Pour la suite : pstack-cli chat --cwd "CHEMIN_DU_PROJET".');
    return;
  }

  let cwd: string;
  while (true) {
    cwd = await required("Chemin absolu du dossier où l'agent travaillera : ", io);
    if (isAbsolute(cwd) && existsSync(cwd) && statSync(cwd).isDirectory()) break;
    io.print("Donne le chemin absolu d'un dossier existant.");
  }
  const opened = await execute(withConfig(["chat", "--cwd", cwd]));
  io.print(opened);
  io.print("Parle directement à l'agent maître ; il utilisera les rôles configurés et leurs CLI pour déléguer via Herdr.");
  return opened.split(" ", 1)[0];
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === "--help" || args[0] === "help")) {
    console.log("Usage: pstack-init [--config PATH]\nGuide interactif pour choisir l'agent maître, les rôles workers et ouvrir la conversation.");
  } else if (args.length !== 0 && (args.length !== 2 || args[0] !== "--config" || !args[1])) {
    console.error("Usage: pstack-init [--config PATH]");
    process.exitCode = 1;
  } else {
    const input = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const masterName = await runOnboarding({
        ask: async (question) => {
          const answer = await input.question(question);
          process.stdout.write("\r\n");
          return answer;
        },
        print: (message) => process.stdout.write(`${message.replace(/\r?\n/g, "\r\n")}\r\n`),
        ...(args[1] ? { configPath: args[1] } : {}),
      });
      if (masterName && process.stdin.isTTY && process.stdout.isTTY && !process.env.HERDR_ENV) {
        input.close();
        process.stdout.write("Quitter le terminal direct avec ctrl+b puis q ; la conversation reste dans Herdr.\r\n");
        process.exitCode = await attachMasterTerminal(masterName);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      input.close();
    }
  }
}
