# streamdeck-cmux

Stream Deck plugin for [cmux](https://github.com/manaflow-ai/cmux) workspace management.

Turns a Stream Deck into a physical dashboard for cmux: switch workspaces with a tap instead of alt-tabbing or keyboard shortcuts, and see at a glance which workspace is selected and which ones have pending Claude notifications.

<img src="screenshot-03.jpeg" width="67%">

## Usage

### Workspace button

Add **Workspace** actions to Stream Deck keys. Buttons are mapped to cmux workspaces by position (sorted left-to-right, top-to-bottom).

Each button uses the workspace's color (from cmux sidebar) as background, with overlays:
- **White border** — currently selected workspace
- **Orange dot** (top-right) — workspace needs input
- **Blue dot** (top-right) — Claude is running
- **Black** — no workspace at this position

Pressing a button selects that workspace in cmux and brings cmux to the front.

### Nightly Toggle

Toggles between stable (`/tmp/cmux.sock`) and nightly (`/tmp/cmux-nightly.sock`) sockets. Shows the target socket name; blue background for stable, purple for nightly.

### New Workspace (ccq)

Creates a new cmux workspace, selects it, and starts `claude --dangerously-skip-permissions` in a temp directory.

## Requirements

- Stream Deck app ≥ 6.4
- macOS ≥ 12.0
- Node.js 20 (bundled by Stream Deck)
- cmux with **Automation mode** socket access

In cmux: Settings → Socket → set to **Automation** (not `cmuxOnly`, since the plugin process is not a cmux descendant).

## Setup

```sh
npm install
npm run setup   # generates PNG images
npm run build   # compiles TypeScript → bin/plugin.js
```

Then double-click `com.cmux.streamdeck.sdPlugin` to install.


## Development

```sh
npm run watch   # rebuild on file change
```

Default socket path is `/tmp/cmux.sock` (override with `CMUX_SOCKET_PATH`). Use the **Nightly Toggle** button to switch between stable and nightly at runtime.
