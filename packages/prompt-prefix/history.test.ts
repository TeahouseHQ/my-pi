import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  historyPath,
  HISTORY_LIMIT,
  normalizeHistory,
  PromptHistoryStore,
  recordHistoryEntry,
} from "./history";

describe("normalizeHistory", () => {
  it("retains genuine prompts, deduplicates globally, and caps recency", () => {
    const entries = ["first", "/reload", "!pwd", "second", "first", "   ", 12];
    expect(normalizeHistory(entries)).toEqual(["second", "first"]);

    const overflow = Array.from(
      { length: HISTORY_LIMIT + 1 },
      (_, index) => `prompt ${index}`,
    );
    expect(normalizeHistory(overflow)).toEqual(overflow.slice(1));
  });

  it("records a duplicate as the newest entry", () => {
    expect(recordHistoryEntry(["old", "new"], "old")).toEqual(["new", "old"]);
  });
});

describe("historyPath", () => {
  it("uses a stable project hash below the agent directory", () => {
    const agentDir = "/tmp/pi-agent";
    expect(historyPath("/workspace/project", agentDir)).toMatch(
      /^\/tmp\/pi-agent\/prompt-history\/[a-f0-9]{64}\.json$/,
    );
    expect(historyPath("/workspace/project", agentDir)).toBe(
      historyPath("/workspace/project", agentDir),
    );
    expect(historyPath("/workspace/other", agentDir)).not.toBe(
      historyPath("/workspace/project", agentDir),
    );
  });
});

describe("PromptHistoryStore", () => {
  it("persists a normalized list and restores it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "prompt-history-"));
    const path = join(directory, "nested", "history.json");
    const store = new PromptHistoryStore(path);

    store.save(["first", "/reload", "second", "first"]);
    await store.flush();

    expect(JSON.parse(await readFile(path, "utf8"))).toEqual([
      "second",
      "first",
    ]);
    expect(await new PromptHistoryStore(path).load()).toEqual([
      "second",
      "first",
    ]);
  });

  it("treats absent or malformed storage as empty history", async () => {
    const directory = await mkdtemp(join(tmpdir(), "prompt-history-"));
    const path = join(directory, "history.json");

    expect(await new PromptHistoryStore(path).load()).toEqual([]);
    await writeFile(path, "not json", "utf8");
    expect(await new PromptHistoryStore(path).load()).toEqual([]);
  });
});
