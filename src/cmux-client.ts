import * as net from "net";

const SOCKET_PATH = process.env.CMUX_SOCKET_PATH ?? "/tmp/cmux.sock";
const RECONNECT_DELAY_MS = 2000;

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

  constructor() {
    this.connect();
  }

  private connect(): void {
    if (this.destroyed) return;

    const sock = net.createConnection(SOCKET_PATH);
    this.socket = sock;
    sock.setEncoding("utf8");

    sock.on("connect", () => {
      this.connected = true;
      this.drain();
    });

    sock.on("data", (chunk: string) => {
      if (!this.inflight) return;
      this.buffer += chunk;

      // Reset the settle timer on every new chunk. When no more data arrives
      // within RESPONSE_SETTLE_MS after the first newline, resolve.
      if (this.buffer.includes("\n")) {
        if (this.settleTimer !== null) clearTimeout(this.settleTimer);
        this.settleTimer = setTimeout(() => this.resolveInflight(), RESPONSE_SETTLE_MS);
      }
    });

    sock.on("close", () => {
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
      // "close" follows; just log
      console.error("[cmux-client] error:", err.message);
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
