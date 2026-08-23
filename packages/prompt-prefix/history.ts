import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const HISTORY_LIMIT = 100;

/** Keep only genuine prompts, with the newest duplicate winning. */
export function normalizeHistory(entries: unknown): string[] {
  if (!Array.isArray(entries)) return [];

  const result: string[] = [];
  for (const value of entries) {
    if (typeof value !== "string") continue;
    const entry = value.trim();
    if (!entry || entry.startsWith("/") || entry.startsWith("!")) continue;

    const priorIndex = result.indexOf(entry);
    if (priorIndex >= 0) result.splice(priorIndex, 1);
    result.push(entry);
  }
  return result.slice(-HISTORY_LIMIT);
}

/** Add one submitted prompt to a recency list ordered oldest to newest. */
export function recordHistoryEntry(entries: string[], text: string): string[] {
  return normalizeHistory([...entries, text]);
}

/** Return the per-project prompt-history file path. */
export function historyPath(cwd: string, agentDir = getAgentDir()): string {
  const projectId = createHash("sha256").update(resolve(cwd)).digest("hex");
  return join(agentDir, "prompt-history", `${projectId}.json`);
}

/**
 * Serializes writes so a rapid series of submissions always leaves the newest
 * recency list on disk. Separate Pi processes still use last-writer-wins.
 */
export class PromptHistoryStore {
  private writeQueue = Promise.resolve();

  constructor(private readonly path: string) {}

  async load(): Promise<string[]> {
    try {
      return normalizeHistory(JSON.parse(await readFile(this.path, "utf8")));
    } catch (error: unknown) {
      if (isMissingFile(error) || error instanceof SyntaxError) return [];
      throw error;
    }
  }

  save(entries: string[]): void {
    const content = `${JSON.stringify(normalizeHistory(entries))}\n`;
    this.writeQueue = this.writeQueue
      .then(async () => {
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        const temporaryPath = join(
          dirname(this.path),
          `.${basename(this.path)}.${process.pid}.tmp`,
        );
        await writeFile(temporaryPath, content, {
          encoding: "utf8",
          mode: 0o600,
        });
        await rename(temporaryPath, this.path);
      })
      .catch((error: unknown) => {
        console.error(`Unable to save prompt history: ${String(error)}`);
      });
  }

  flush(): Promise<void> {
    return this.writeQueue;
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
