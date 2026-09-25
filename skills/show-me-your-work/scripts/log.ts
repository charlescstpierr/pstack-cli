#!/usr/bin/env bun
import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";

const header = "ts\tphase\tdecision\twhy\tevidence\tresult\n";

function cell(value: string): string {
  const singleLine = value.replace(/[\t\r\n]/g, " ");
  return /^[=+\-@]/.test(singleLine) ? `'${singleLine}` : singleLine;
}

export async function appendDecision(
  values: string[],
  now = new Date(),
): Promise<void> {
  if (values.length !== 6 || !values[0]) {
    throw new Error("usage: bun skills/show-me-your-work/scripts/log.ts <logfile> <phase> <decision> <why> <evidence> <result>");
  }
  const [path, phase, decision, why, evidence, result] = values;
  await mkdir(dirname(path), { recursive: true });
  const file = await open(path, "a+");
  try {
    if ((await file.stat()).size === 0) await file.write(header);
    const ts = now.toISOString().replace(/\.\d{3}Z$/, "Z");
    await file.write([ts, phase, decision, why, evidence, result].map(cell).join("\t") + "\n");
  } finally {
    await file.close();
  }
}

if (import.meta.main) {
  try { await appendDecision(process.argv.slice(2)); }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
