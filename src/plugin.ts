import * as fs from "fs";
import streamDeck from "@elgato/streamdeck";
import { CmuxClient } from "./cmux-client";
import { Poller } from "./poller";
import { WorkspaceButton } from "./actions/workspace-button";
import { NewWorkspaceCcq } from "./actions/new-workspace-ccq";
import { SocketToggle } from "./actions/socket-toggle";
import { RestartStreamDeck } from "./actions/restart-streamdeck";

const LOG = "/tmp/streamdeck-cmux-debug.log";
function log(msg: string) { try { fs.appendFileSync(LOG, `${new Date().toISOString()} [plugin] ${msg}\n`); } catch {} }

log("plugin starting");

streamDeck.logger.setLevel("info");

log("creating client");
const client = new CmuxClient();

log("creating poller");
const poller = new Poller(client);

log("starting poller");
poller.start();

log("registering actions");
streamDeck.actions.registerAction(new WorkspaceButton(client, poller));
streamDeck.actions.registerAction(new NewWorkspaceCcq(client));
streamDeck.actions.registerAction(new SocketToggle(client, poller));
streamDeck.actions.registerAction(new RestartStreamDeck());

streamDeck.system.onSystemDidWakeUp(() => {
  log("system woke up, reconnecting socket and pausing poller");
  poller.pause();
  client.reconnect(client.getSocketPath());
  setTimeout(() => {
    log("resuming poller after wake");
    poller.start();
  }, 3000);
});

log("connecting to stream deck");
streamDeck.connect();
log("connect() called");
