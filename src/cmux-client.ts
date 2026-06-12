import * as net from "net";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const CMUX_DIR = path.join(os.homedir(), "Library/Application Support/cmux");

// Legacy fixed control-socket path. Older cmux builds listened here; newer ones
// namespace the socket by UID (see resolveSocketPath), so this is a fallback.
export const SOCKET_PATH = path.join(CMUX_DIR, "cmux.sock");

// cmux records the path of its currently-listening control socket in a marker
// file and rewrites it on every launch. The location moved between cmux
// versions, so check the current location first, then the legacy /tmp one.
const LAST_SOCKET_PATH_FILES = [
  path.join(CMUX_DIR, "last-socket-path"),
  "/tmp/cmux-last-socket-path",
];

/**
 * Resolve cmux's currently-listening control socket path.
 *
 * Newer cmux builds namespace the Unix socket by UID (e.g. `cmux-501.sock`)
 * instead of the fixed `cmux.sock`, and record the live path in a
 * `last-socket-path` marker file. A hard-coded path therefore goes stale across
 * cmux upgrades/restarts, leaving the plugin stuck on ECONNREFUSED with no
 * workspaces shown. Follow the marker file when present (trying the current and
 * legacy locations), falling back to the legacy fixed path.
 */
export function resolveSocketPath(): string {
  for (const file of LAST_SOCKET_PATH_FILES) {
    try {
      const p = fs.readFileSync(file, "utf8").trim();
      if (p) return p;
    } catch {}
  }
  return SOCKET_PATH;
}

const DEFAULT_SOCKET_PATH = process.env.CMUX_SOCKET_PATH ?? resolveSocketPath();
const RECONNECT_DELAY_MS = 2000;

const LOG_PATH = "/tmp/streamdeck-cmux-debug.log";
function debugLog(msg: string): void {
  try { fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} [client] ${msg}\n`); } catch {}
}

// After seeing the first newline in a response, wait this long for more data
// before resolving. Matches cmux.py's select(timeout=0.1) heuristic for
// multi-line responses (list_workspaces, list_notifications).
const RESPONSE_SETTLE_MS = 80;

interface QueuedCommand {
  command: string;
  resolve: (response: string) => void;
  reject: (err: Error) => void;
}

export class CmuxClient {
  private socket: net.Socket | null = null;
  private buffer = "";
  private queue: QueuedCommand[] = [];
  private inflight: QueuedCommand | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;
  private destroyed = false;
  private socketPath: string;
  private generation = 0;
  // When true, the socket path was set explicitly (constructor arg, reconnect(),
  // or CMUX_SOCKET_PATH) and connect() should not re-resolve the live socket.
  private pinned = false;

  constructor(socketPath?: string) {
    if (socketPath !== undefined) {
      this.socketPath = socketPath;
      this.pinned = true;
    } else {
      this.socketPath = DEFAULT_SOCKET_PATH;
      this.pinned = process.env.CMUX_SOCKET_PATH !== undefined;
    }
    this.connect();
  }

  getSocketPath(): string {
    return this.socketPath;
  }

  reconnect(socketPath: string): void {
    debugLog(`reconnect: switching to ${socketPath}`);
    this.generation++;
    this.socketPath = socketPath;
    this.pinned = true;
    this.connected = false;
    this.destroyed = false;
    this.cancelSettle();
    if (this.inflight) {
      this.inflight.reject(new Error("reconnecting"));
      this.inflight = null;
    }
    for (const item of this.queue) {
      item.reject(new Error("reconnecting"));
    }
    this.queue = [];
    this.buffer = "";
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    this.connect();
  }

  private connect(): void {
    if (this.destroyed) return;

    // Self-heal: re-resolve cmux's live socket on each (re)connect so the plugin
    // follows it when the socket name changes across a cmux upgrade/restart.
    // Skipped when the path was pinned explicitly.
    if (!this.pinned) {
      this.socketPath = resolveSocketPath();
    }

    const gen = this.generation;
    debugLog(`connect: ${this.socketPath} (gen=${gen})`);
    const sock = net.createConnection(this.socketPath);
    this.socket = sock;
    sock.setEncoding("utf8");

    sock.on("connect", () => {
      if (gen !== this.generation) return;
      debugLog(`connected to ${this.socketPath} (gen=${gen})`);
      this.connected = true;
      this.drain();
    });

    sock.on("data", (chunk: string) => {
      if (gen !== this.generation || !this.inflight) return;
      this.buffer += chunk;

      // Reset the settle timer on every new chunk. When no more data arrives
      // within RESPONSE_SETTLE_MS after the first newline, resolve.
      if (this.buffer.includes("\n")) {
        if (this.settleTimer !== null) clearTimeout(this.settleTimer);
        this.settleTimer = setTimeout(() => this.resolveInflight(), RESPONSE_SETTLE_MS);
      }
    });

    sock.on("close", () => {
      if (gen !== this.generation) {
        debugLog(`stale socket closed (gen=${gen}, current=${this.generation}), ignoring`);
        return;
      }
      debugLog(`socket closed (gen=${gen})`);
      this.connected = false;
      this.socket = null;
      this.cancelSettle();
      if (this.inflight) {
        this.inflight.reject(new Error("socket closed"));
        this.inflight = null;
        this.buffer = "";
      }
      this.scheduleReconnect();
    });

    sock.on("error", (err) => {
      debugLog(`socket error: ${err.message} (gen=${gen})`);
    });
  }

  private resolveInflight(): void {
    this.settleTimer = null;
    if (!this.inflight) return;

    let response = this.buffer;
    this.buffer = "";

    // Strip trailing newline (server always appends one)
    if (response.endsWith("\n")) response = response.slice(0, -1);

    this.inflight.resolve(response);
    this.inflight = null;
    this.drain();
  }

  private cancelSettle(): void {
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
  }

  private drain(): void {
    if (!this.connected || this.inflight || this.queue.length === 0) return;
    const item = this.queue.shift()!;
    this.inflight = item;
    this.socket!.write(item.command + "\n");
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
  }

  /** Send a command; resolves with the full response (may be multi-line). */
  send(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.queue.push({ command, resolve, reject });
      this.drain();
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.cancelSettle();
    this.socket?.destroy();
  }
}
