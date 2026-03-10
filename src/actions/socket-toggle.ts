import streamDeck, {
  action,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";
import { CmuxClient, SOCKET_PATHS } from "../cmux-client";
import { Poller } from "../poller";

function labelFor(socketPath: string): string {
  if (socketPath.includes("nightly")) return "nightly";
  return "cmux";
}

function bgFor(socketPath: string): string {
  const color = socketPath.includes("nightly") ? "#8B5CF6" : "#0A84FF";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144"><rect width="144" height="144" fill="${color}"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

@action({ UUID: "com.cmux.streamdeck.socket-toggle" })
export class SocketToggle extends SingletonAction {
  constructor(
    private readonly client: CmuxClient,
    private readonly poller: Poller
  ) {
    super();
  }

  override onWillAppear(ev: WillAppearEvent): void {
    if (ev.action.isKey()) {
      this.updateButton(ev);
    }
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const current = this.client.getSocketPath();
    const next = SOCKET_PATHS.find((p) => p !== current) ?? SOCKET_PATHS[0];

    this.client.reconnect(next);
    this.poller.reset();

    if (ev.action.isKey()) {
      this.updateButton(ev);
    }

    streamDeck.logger.info(`Switched socket to ${next}`);
  }

  private updateButton(ev: WillAppearEvent | KeyDownEvent): void {
    const current = this.client.getSocketPath();
    const next = SOCKET_PATHS.find((p) => p !== current) ?? SOCKET_PATHS[0];
    void ev.action.setTitle(labelFor(next));
    void ev.action.setImage(bgFor(next));
  }
}
