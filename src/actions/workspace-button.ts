import streamDeck, {
  action,
  KeyAction,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent,
} from "@elgato/streamdeck";
import * as fs from "fs";
import { execFile } from "child_process";
import { CmuxClient } from "../cmux-client";
import { Poller, WorkspaceState } from "../poller";

interface Settings {}

const STATE_NORMAL = 0;
const STATE_ACTIVE = 1;
const STATE_INPUT  = 2;
const STATE_EMPTY  = 3;

interface ActionEntry {
  action: KeyAction;
  row: number;
  column: number;
}

@action({ UUID: "com.cmux.streamdeck.workspace" })
export class WorkspaceButton extends SingletonAction<Settings> {
  private activeActions = new Map<string, ActionEntry>();

  constructor(
    private readonly client: CmuxClient,
    private readonly poller: Poller
  ) {
    super();
    poller.addListener((ws) => this.updateAll(ws));
  }

  override onWillAppear(ev: WillAppearEvent<Settings>): void {
    if (!ev.action.isKey()) return;
    const coords = (ev.payload as any).coordinates ?? { column: 0, row: 0 };
    this.activeActions.set(ev.action.id, {
      action: ev.action,
      row: coords.row,
      column: coords.column,
    });
    this.updateAll(this.poller.getLastState());
  }

  override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
    this.activeActions.delete(ev.action.id);
  }

  override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
    if (!ev.action.isKey()) return;
    const idx = this.indexForAction(ev.action.id);
    if (idx < 0) return;
    const ws = findByIndex(this.poller.getLastState(), idx);
    if (!ws) return;
    try {
      await this.client.send(`select_workspace ${ws.id}`);
      execFile("osascript", ["-e", 'tell application "cmux" to activate']);
    } catch (err) {
      streamDeck.logger.error("select_workspace failed:", err);
    }
  }

  private sorted(): ActionEntry[] {
    return [...this.activeActions.values()].sort(
      (a, b) => a.row - b.row || a.column - b.column
    );
  }

  private indexForAction(actionId: string): number {
    return this.sorted().findIndex((e) => e.action.id === actionId);
  }

  private updateAll(workspaces: Map<string, WorkspaceState>): void {
    const entries = this.sorted();
    debugLog(`updateAll: ${entries.length} buttons, ${workspaces.size} workspaces`);
    for (let i = 0; i < entries.length; i++) {
      this.updateButton(entries[i].action, i, workspaces);
    }
  }

  private updateButton(
    act: KeyAction,
    idx: number,
    workspaces: Map<string, WorkspaceState>
  ): void {
    const ws = findByIndex(workspaces, idx);
    if (!ws) {
      debugLog(`button ${idx}: empty`);
      void act.setImage(colorSvg("#000000"));
      void act.setTitle("");
      return;
    }

    const bg = ws.color ?? "#2C2C2E";

    const clean = ws.title.replace(/^[✳*]\s*/, "").trim();
    const wrapped = wrapTitle(clean);
    debugLog(`button ${idx}: "${clean}" bg=${bg} selected=${ws.isSelected} unread=${ws.hasUnread} running=${ws.isRunning}`);
    void act.setImage(colorSvg(bg, { selected: ws.isSelected, unread: ws.hasUnread, running: ws.isRunning }));
    void act.setTitle(wrapped);
  }
}

function findByIndex(
  workspaces: Map<string, WorkspaceState>,
  idx: number
): WorkspaceState | undefined {
  for (const ws of workspaces.values()) {
    if (ws.index === idx) return ws;
  }
  return undefined;
}

function colorSvg(hex: string, opts?: { selected?: boolean; unread?: boolean; running?: boolean }): string {
  let overlay = "";
  if (opts?.selected) {
    overlay = `<rect x="4" y="4" width="136" height="136" rx="8" fill="none" stroke="#FFFFFF" stroke-width="8"/>`;
  }
  if (opts?.unread) {
    overlay += `<circle cx="122" cy="22" r="18" fill="#FF9F0A"/>`;
  } else if (opts?.running) {
    overlay += `<circle cx="122" cy="22" r="18" fill="#0A84FF"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144"><rect width="144" height="144" fill="${hex}"/>${overlay}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function wrapTitle(title: string): string {
  return title
    .split(/[-\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("\n");
}

const LOG_PATH = "/tmp/streamdeck-cmux-debug.log";
function debugLog(msg: string): void {
  try { fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${msg}\n`); } catch {}
}
