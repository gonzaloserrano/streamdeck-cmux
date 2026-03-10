import * as fs from "fs";
import { CmuxClient } from "./cmux-client";

const LOG_PATH = "/tmp/streamdeck-cmux-debug.log";
function debugLog(msg: string): void {
  try { fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} [poller] ${msg}\n`); } catch {}
}

export interface WorkspaceState {
  index: number;
  id: string;
  title: string;
  color: string | null;
  isSelected: boolean;
  hasUnread: boolean;
  isRunning: boolean;
}

export type PollerListener = (workspaces: Map<string, WorkspaceState>) => void;

const POLL_INTERVAL_MS = 500;

export class Poller {
  private listeners = new Set<PollerListener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastState: Map<string, WorkspaceState> = new Map();
  private generation = 0;

  constructor(private client: CmuxClient) {}

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => { void this.poll(); }, POLL_INTERVAL_MS);
    void this.poll();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getLastState(): Map<string, WorkspaceState> {
    return this.lastState;
  }

  addListener(fn: PollerListener): void {
    this.listeners.add(fn);
    if (this.lastState.size > 0) fn(this.lastState);
  }

  removeListener(fn: PollerListener): void {
    this.listeners.delete(fn);
  }

  reset(): void {
    this.generation++;
    this.stop();
    this.lastState = new Map();
    this.start();
  }

  private async poll(): Promise<void> {
    const gen = this.generation;
    try {
      debugLog("polling...");
      const wsRaw = await this.client.send("list_workspaces");
      if (gen !== this.generation) return;
      debugLog(`list_workspaces: ${JSON.stringify(wsRaw).slice(0, 200)}`);
      const workspaces = parseWorkspaces(wsRaw);

      // Fetch color per workspace via sidebar_state
      for (const ws of workspaces.values()) {
        if (gen !== this.generation) return;
        try {
          const state = await this.client.send(`sidebar_state --tab=${ws.id}`);
          if (gen !== this.generation) return;
          const m = state.match(/^color=(.+)$/m);
          if (m && m[1] !== "none") ws.color = m[1];
        } catch {}
      }

      debugLog(`parsed ${workspaces.size} workspaces`);

      this.lastState = workspaces;
      for (const fn of this.listeners) fn(workspaces);
    } catch (err) {
      debugLog(`poll error: ${err}`);
    }
  }
}

/**
 * Parses `list_workspaces` output.
 *
 * Format (selected workspace has leading "*"):
 *   * 0: <uuid> <title>
 *     1: <uuid> <title>
 */
function parseWorkspaces(raw: string): Map<string, WorkspaceState> {
  const result = new Map<string, WorkspaceState>();
  if (raw === "No workspaces") return result;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const isSelected = trimmed.startsWith("*");
    const rest = trimmed.replace(/^\*?\s*/, "");
    const m = rest.match(/^(\d+):\s+(\S+)\s+(.*)/);
    if (!m) continue;

    const [, idxStr, id, title] = m;
    const index = parseInt(idxStr, 10);
    const trimmedTitle = title.trim();

    result.set(id, {
      index,
      id,
      title: trimmedTitle,
      color: null,
      isSelected,
      hasUnread: trimmedTitle.startsWith("✳"),
      isRunning: trimmedTitle.startsWith("⠂"),
    });
  }
  return result;
}
