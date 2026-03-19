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

const CLAUDE_LOGO_B64 = "iVBORw0KGgoAAAANSUhEUgAAALAAAAB9CAYAAAACwek0AAABRWlDQ1BJQ0MgUHJvZmlsZQAAeJx9kL1LA0EQxd/Fk+BHEcHS4jojRJEodhYxhYgKR/y222zOi3A5l72TaG1rLWJlZa0gpBKsxF5Q0f/AVrjGhHU2p15UdGF2frx9Ozs7QMpkQngmgJofytLsjLW+sWmlX5DCAHqQRYbxQBRse4Es+MzfV3QPQ+e7UV3r9/m/q7fiBJxykyLHhQwBI0ts10OheY94UFJTxIea3ZhPNZdjvmx7lktF4lviDK+yCvGjrlnu0N0Ornm7/KMH3X2/468saZ1iCItgCOFgFdu01//wTra9RexAYB+SvC6qdM9CgRQBj+5amIMPjjHkiPMYp5jSM/45u0Q7OAamG0qpq0Sbp/9cnNDTzUQbfqZ2z4GbUDDJviZqRGawNZGPua8BdB8p9boGpEeA1oNSb1S7dQZ0PQHX0TvENGBT4se92AAAAaBJREFUeJzt3LENwkAQRUEb0ZVLob4rhbogIHFKsIhnzRSwwenpwr9vQ56Px2vqNj3HWvvE3dvEUfgVAZMmYNIETJqASRMwaQImTcCkCZg0AZMmYNIETJqASRMwaQImTcCkCZg0AZMmYNIETJqASRMwaQImTcCk3bcLD2QYV7n+m/mBSRMwaQImTcCkCZg0AZMmYNIETJqASRMwaQImTcCkCZg0AZMmYNIETJqASRMwaQImTcCkCZg0AZMmYNIETNpeG7KAMz8waQImTcCkCZg0AZMmYNIETJqASRMwaQImTcCkCZg0AZMmYNIETJqASRMwaQImTcCkCZg0AZMmYNIETJqASdunDhtM4exYa6Q1PzBpAiZNwKQJmDQBkyZg0gRMmoBJEzBpAiZNwKQJmDQBkyZg0gRMmoBJEzBpAiZNwKQJmDQBkyZg0gRMmoBJGxs2mRpB+WYgY+ruP/BmH35g0gRMmoBJEzBpAiZNwKQJmDQBkyZg0gRMmoBJEzBpAiZNwKQJmDQBkyZg0gRMmoBJEzBpAiZNwKQJmDQBs5W9AQq9I3M5j1R6AAAAAElFTkSuQmCC";

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
    debugLog(`keyDown: idx=${idx} ws=${ws.id} title="${ws.title}"`);
    const appName = this.client.getSocketPath().includes("nightly") ? "cmux NIGHTLY" : "cmux";
    execFile("osascript", ["-e", `tell application "${appName}" to activate`]);
    try {
      const result = await this.client.send(`select_workspace ${ws.id}`);
      debugLog(`select_workspace result: ${result}`);
      this.poller.forcePoll();
    } catch (err) {
      debugLog(`select_workspace error: ${err}`);
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

    const displayTitles = new Map<string, string>();
    for (const ws of workspaces.values()) {
      displayTitles.set(ws.id, ws.title.replace(/^[✳⠂*]\s*/, "").trim());
    }

    for (let i = 0; i < entries.length; i++) {
      this.updateButton(entries[i].action, i, workspaces, displayTitles);
    }
  }

  private updateButton(
    act: KeyAction,
    idx: number,
    workspaces: Map<string, WorkspaceState>,
    displayTitles: Map<string, string>
  ): void {
    const ws = findByIndex(workspaces, idx);
    if (!ws) {
      debugLog(`button ${idx}: empty`);
      void act.setImage(emptySvg());
      void act.setTitle("");
      return;
    }

    const baseColor = ws.color ?? "#2C2C2E";
    const bg = ws.isSelected ? lightenColor(baseColor, 0.35) : baseColor;
    const title = displayTitles.get(ws.id) ?? ws.title;
    const isClaudeCode = title === "Claude Code";
    const titleLines = isClaudeCode ? [] : splitTitle(title);
    debugLog(`button ${idx}: "${title}" bg=${bg} selected=${ws.isSelected} unread=${ws.hasUnread} running=${ws.isRunning} progress=${ws.progress}`);
    void act.setImage(colorSvg(bg, {
      unread: ws.hasUnread,
      running: ws.isRunning,
      progress: ws.progress,
      titleLines,
      cwd: ws.cwd,
      logo: isClaudeCode ? CLAUDE_LOGO_B64 : undefined,
    }));
    void act.setTitle("");
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

function emptySvg(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144"><rect width="144" height="144" rx="12" fill="#1A1A1A"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

interface SvgOpts {
  unread?: boolean;
  running?: boolean;
  progress?: number | null;
  titleLines?: string[];
  cwd?: string | null;
  logo?: string;
}

function colorSvg(hex: string, opts?: SvgOpts): string {
  let overlay = "";
  if (opts?.unread) {
    overlay += `<rect x="0" y="0" width="144" height="9" rx="4" fill="#FF9F0A"/>`;
  } else if (opts?.running) {
    overlay += `<rect x="0" y="0" width="144" height="9" rx="4" fill="#FF6B9D"/>`;
  }
  if (opts?.progress != null) {
    overlay += `<rect x="4" y="134" width="${opts.progress * 136}" height="6" rx="3" fill="#FFFFFF" opacity="0.6"/>`;
  }

  // Logo for Claude Code workspaces
  if (opts?.logo) {
    const logoW = 40;
    const logoH = 30;
    const logoX = (144 - logoW) / 2;
    const logoY = 30;
    overlay += `<image x="${logoX}" y="${logoY}" width="${logoW}" height="${logoH}" href="data:image/png;base64,${opts.logo}"/>`;
  }

  // Compute title metrics (needed to decide CWD layout)
  const areaTop = 12;
  const titleLines = opts?.titleLines ?? [];
  let titleFontSize = 0;
  let titleLineHeight = 0;
  let titleTotalHeight = 0;
  if (titleLines.length) {
    const longestTitle = Math.max(...titleLines.map((l) => l.length));
    titleFontSize = Math.max(16, Math.min(26, Math.floor(26 * 10 / longestTitle)));
    titleLineHeight = titleFontSize + 4;
    titleTotalHeight = titleLines.length * titleLineHeight;
  }
  const contentTop = opts?.logo ? 60 : areaTop;
  const availableForCwd = 132 - contentTop - titleTotalHeight - 6;

  // CWD path (cyan, 1 or 2 lines depending on available space)
  const cwdMaxFont = 24;
  const cwdMinFont = 14;
  let cwdHeight = 0;
  if (opts?.cwd) {
    const cwdParts = availableForCwd >= 50 ? splitCwdLines(opts.cwd) : [opts.cwd];
    if (cwdParts.length === 2) {
      const longestPart = Math.max(cwdParts[0].length, cwdParts[1].length);
      const cwdFontSize = Math.max(cwdMinFont, Math.min(cwdMaxFont, Math.floor(cwdMaxFont * 11 / longestPart)));
      const cwdLineHeight = cwdFontSize + 2;
      cwdHeight = 2 * cwdLineHeight;
      const y1 = 132 - cwdLineHeight;
      overlay += `<text x="72" y="${y1}" text-anchor="middle" fill="#64D2FF" font-family="sans-serif" font-size="${cwdFontSize}">${escapeXml(cwdParts[0])}</text>`;
      overlay += `<text x="72" y="132" text-anchor="middle" fill="#64D2FF" font-family="sans-serif" font-size="${cwdFontSize}">${escapeXml(cwdParts[1])}</text>`;
    } else {
      const cwdChars = opts.cwd.length;
      const cwdFontSize = Math.max(cwdMinFont, Math.min(cwdMaxFont, Math.floor(cwdMaxFont * 11 / cwdChars)));
      cwdHeight = cwdFontSize + 4;
      overlay += `<text x="72" y="132" text-anchor="middle" fill="#64D2FF" font-family="sans-serif" font-size="${cwdFontSize}">${escapeXml(opts.cwd)}</text>`;
    }
  }

  // Title text (white, bold, dynamic font size)
  if (titleLines.length) {
    const areaBottom = cwdHeight > 0 ? 132 - cwdHeight - 2 : 134;
    const startY = areaTop + (areaBottom - areaTop - titleTotalHeight) / 2 + titleFontSize;
    for (let i = 0; i < titleLines.length; i++) {
      const y = startY + i * titleLineHeight;
      overlay += `<text x="72" y="${y}" text-anchor="middle" fill="#FFFFFF" font-family="sans-serif" font-size="${titleFontSize}" font-weight="700">${escapeXml(titleLines[i])}</text>`;
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144"><rect width="144" height="144" fill="${hex}"/>${overlay}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function splitCwdLines(cwd: string): string[] {
  const idx = cwd.indexOf("-");
  if (idx < 0 || idx === cwd.length - 1) return [cwd];
  return [cwd.slice(0, idx + 1), cwd.slice(idx + 1)];
}

function lightenColor(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lr = Math.min(255, Math.round(r + (255 - r) * amount));
  const lg = Math.min(255, Math.round(g + (255 - g) * amount));
  const lb = Math.min(255, Math.round(b + (255 - b) * amount));
  return `#${lr.toString(16).padStart(2, "0")}${lg.toString(16).padStart(2, "0")}${lb.toString(16).padStart(2, "0")}`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}


function splitTitle(title: string): string[] {
  const maxChars = 12;
  const maxLines = 3;
  const words = title.split(/[-\s]+/);

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
    } else if ((current + " " + word).length <= maxChars) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines - 1);
  const remaining = lines.slice(maxLines - 1).join(" ");
  kept.push(remaining.length <= maxChars ? remaining : remaining.slice(0, maxChars - 3).trim() + "...");
  return kept;
}

const LOG_PATH = "/tmp/streamdeck-cmux-debug.log";
function debugLog(msg: string): void {
  try { fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${msg}\n`); } catch {}
}
