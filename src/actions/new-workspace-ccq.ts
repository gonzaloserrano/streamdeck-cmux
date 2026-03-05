import streamDeck, {
  action,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";
import { CmuxClient } from "../cmux-client";

const DELAY_MS = 300;

const COLOR_PALETTE = [
  "#C0392B", "#922B21", "#A04000", "#7D6608",
  "#4A5C18", "#196F3D", "#006B6B", "#0E6B8C",
  "#1565C0", "#1A5276", "#283593", "#6A1B9A",
  "#AD1457", "#880E4F", "#7B3F00", "#3E4B5E",
];
let colorIndex = 0;

const CCQ_BG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144"><rect width="144" height="144" fill="#30D158"/></svg>`;
const CCQ_BG = `data:image/svg+xml;base64,${Buffer.from(CCQ_BG_SVG).toString("base64")}`;

@action({ UUID: "com.cmux.streamdeck.new-workspace-ccq" })
export class NewWorkspaceCcq extends SingletonAction {
  constructor(private readonly client: CmuxClient) {
    super();
  }

  override onWillAppear(ev: WillAppearEvent): void {
    if (ev.action.isKey()) {
      void ev.action.setImage(CCQ_BG);
      void ev.action.setTitle("+ ccq");
    }
  }

  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    try {
      const newResp = await this.client.send("new_workspace");
      const uuid = newResp.trim().replace(/^OK\s+/, "");
      if (!uuid) throw new Error(`Unexpected new_workspace response: ${newResp}`);

      const color = COLOR_PALETTE[colorIndex % COLOR_PALETTE.length];
      colorIndex++;

      await this.client.send(`set_workspace_color ${uuid} ${color}`);
      await this.client.send(`select_workspace ${uuid}`);

      await delay(DELAY_MS);

      await this.client.send("send cd $(mktemp -d) && claude --dangerously-skip-permissions\\n");
    } catch (err) {
      streamDeck.logger.error("new-workspace-ccq failed:", err);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
