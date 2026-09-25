import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendDecision } from "./log.ts";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true }))); });

test("appends one header and sanitizes every TSV cell", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pstack-trail-"));
  dirs.push(dir);
  const path = join(dir, "nested", "decisions.tsv");
  const now = new Date("2026-09-25T14:03:02.000Z");
  await appendDecision([path, "=phase", "a\tb", "+reason\nnext", "@evidence", "-result"], now);
  await appendDecision([path, "review", "accepted", "clear", "file:1", "done"], now);
  expect(await readFile(path, "utf8")).toBe(
    "ts\tphase\tdecision\twhy\tevidence\tresult\n" +
    "2026-09-25T14:03:02Z\t'=phase\ta b\t'+reason next\t'@evidence\t'-result\n" +
    "2026-09-25T14:03:02Z\treview\taccepted\tclear\tfile:1\tdone\n",
  );
});

test("requires every cell before opening a log", async () => {
  await expect(appendDecision(["missing.tsv", "only one"], new Date("2026-09-25T00:00:00Z")))
    .rejects.toThrow("usage:");
  await expect(appendDecision(["missing.tsv", "p", "d", "w", "e", "r", "extra"]))
    .rejects.toThrow("usage:");
});
