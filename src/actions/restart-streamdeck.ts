import { action, KeyDownEvent, SingletonAction, WillAppearEvent } from "@elgato/streamdeck";
import { execFile } from "child_process";

const RESTART_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144">
  <rect width="144" height="144" rx="12" fill="#E53935"/>
  <path d="M72 36 A32 32 0 1 1 46 56" fill="none" stroke="white" stroke-width="8" stroke-linecap="round"/>
  <polygon points="46,40 34,58 58,58" fill="white"/>
</svg>`;
const RESTART_IMG = `data:image/svg+xml;base64,${Buffer.from(RESTART_SVG).toString("base64")}`;

@action({ UUID: "com.cmux.streamdeck.restart" })
export class RestartStreamDeck extends SingletonAction {
  override onWillAppear(ev: WillAppearEvent): void {
    if (ev.action.isKey()) {
      void ev.action.setImage(RESTART_IMG);
      void ev.action.setTitle("");
    }
  }

  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    execFile("bash", ["-c", 'killall "Stream Deck"; sleep 2; open "/Applications/Elgato Stream Deck.app"']);
  }
}
