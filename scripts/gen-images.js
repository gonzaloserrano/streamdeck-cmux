#!/usr/bin/env node
// Generates 72×72 solid-color PNG state images using pngjs (pure JS, no native deps).

const { PNG } = require("pngjs");
const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join(__dirname, "..", "com.cmux.streamdeck.sdPlugin", "imgs");
fs.mkdirSync(OUT_DIR, { recursive: true });

const SIZE = 72;

function hexToRgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function solidPng(color) {
  const png = new PNG({ width: SIZE, height: SIZE });
  const { r, g, b } = hexToRgb(color);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const idx = (y * SIZE + x) * 4;
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = 255;
    }
  }
  return png;
}

// Draw a centered rectangle glyph (for action icons).
function withGlyph(png, glyphColor, gw, gh) {
  const { r, g, b } = hexToRgb(glyphColor);
  const ox = Math.floor((SIZE - gw) / 2);
  const oy = Math.floor((SIZE - gh) / 2);
  for (let y = oy; y < oy + gh; y++) {
    for (let x = ox; x < ox + gw; x++) {
      const idx = (y * SIZE + x) * 4;
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = 255;
    }
  }
}

// Draw a "+" glyph (for new-workspace action icon).
function withPlusGlyph(png, glyphColor, thickness, length) {
  const { r, g, b } = hexToRgb(glyphColor);
  const cx = Math.floor(SIZE / 2);
  const cy = Math.floor(SIZE / 2);
  const half = Math.floor(length / 2);
  const halfT = Math.floor(thickness / 2);

  // Horizontal bar
  for (let y = cy - halfT; y <= cy + halfT; y++) {
    for (let x = cx - half; x <= cx + half; x++) {
      const idx = (y * SIZE + x) * 4;
      png.data[idx] = r; png.data[idx + 1] = g; png.data[idx + 2] = b; png.data[idx + 3] = 255;
    }
  }
  // Vertical bar
  for (let y = cy - half; y <= cy + half; y++) {
    for (let x = cx - halfT; x <= cx + halfT; x++) {
      const idx = (y * SIZE + x) * 4;
      png.data[idx] = r; png.data[idx + 1] = g; png.data[idx + 2] = b; png.data[idx + 3] = 255;
    }
  }
}

function save(png, name) {
  const file = path.join(OUT_DIR, name);
  const buf = PNG.sync.write(png);
  fs.writeFileSync(file, buf);
  console.log(`  wrote ${name}`);
}

console.log("Generating images →", OUT_DIR);

// State images
save(solidPng("#2C2C2E"), "state-normal.png");
save(solidPng("#0A84FF"), "state-active.png");
save(solidPng("#FF9F0A"), "state-input.png");
save(solidPng("#000000"), "state-empty.png");
save(solidPng("#30D158"), "state-ccq.png");

// Action icon: workspace (dark bg + small window-pane glyph)
const wsIcon = solidPng("#3A3A3C");
withGlyph(wsIcon, "#8E8E93", 36, 28);
save(wsIcon, "action-workspace.png");

// Action icon: new-workspace (dark bg + "+" glyph)
const nwIcon = solidPng("#3A3A3C");
withPlusGlyph(nwIcon, "#8E8E93", 4, 36);
save(nwIcon, "action-new-workspace.png");

console.log("Done.");
