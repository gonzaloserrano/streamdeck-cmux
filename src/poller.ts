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
}

export type PollerListener = (workspaces: Map<string, WorkspaceState>) => void;

const POLL_INTERVAL_MS = 500;

export class Poller {
  private listeners = new Set<PollerListener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastState: Map<string, WorkspaceState> = new Map();

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

  private async poll(): Promise<void> {
    try {
      debugLog("polling...");
      const wsRaw = await this.client.send("list_workspaces");
      debugLog(`list_workspaces: ${JSON.stringify(wsRaw).slice(0, 200)}`);
      const notifRaw = await this.client.send("list_notifications");
      debugLog(`list_notifications: ${JSON.stringify(notifRaw).slice(0, 200)}`);

      const colorsRaw = await this.client.send("list_workspace_colors");
      const colors = parseWorkspaceColors(colorsRaw);
      const unreadIds = parseNeedsInputWorkspaceIds(notifRaw);
      debugLog(`needsInput: ${JSON.stringify([...unreadIds])}`);
      const workspaces = parseWorkspaces(wsRaw, unreadIds, colors);
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
function parseWorkspaces(
  raw: string,
  unreadIds: Set<string>,
  colors: Map<string, string>
): Map<string, WorkspaceState> {
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

    result.set(id, {
      index,
      id,
      title: title.trim(),
      color: colors.get(id) ?? null,
      isSelected,
      hasUnread: unreadIds.has(id),
    });
  }
  return result;
}

function parseWorkspaceColors(raw: string): Map<string, string> {
  const result = new Map<string, string>();
  if (raw === "No colors") return result;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(\S+)\s+(#\S+)/);
    if (m) result.set(m[1], m[2]);
  }
  return result;
}

/**
 * Parses `list_notifications` output; returns workspace UUIDs that need input.
 *
 * Format: `<n>:<notif_uuid>|<workspace_uuid>|<surface_uuid_or_none>|read_status|title|sub|body`
 *
 * A workspace needs input if it has an unread notification OR its latest
 * notification body indicates Claude is waiting ("Claude is waiting for your input").
 */
function parseNeedsInputWorkspaceIds(raw: string): Set<string> {
  const ids = new Set<string>();
  if (raw === "No notifications") return ids;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const content = trimmed.replace(/^\d+:/, "");
    const parts = content.split("|");
    if (parts.length < 4) continue;

    const isUnread = parts[3] === "unread";
    const body = parts.length >= 7 ? parts[6] : "";
    const needsInput = isUnread || body === "Claude is waiting for your input";

    if (needsInput) {
      ids.add(parts[1]);
    }
  }
  return ids;
}
