/**
 * Draws every launcher / splash asset from the ONE true geometry of the mark —
 * the Adinkrahene as it is in Figma (Kandoo-UI, "adinkrahene-symbol", a 72-unit
 * master) and in src/components/Symbol.tsx:
 *
 *   disc 72 #2F241B · cream 54 (a 9-thick outer ring) · olive 40 ·
 *   cream 24 (an 8-thick olive ring) · amber core 12
 *
 * The icon files were once drawn by hand with the wrong proportions (a thin
 * outer ring, a fat olive band), and a prebuild put those on the home screen.
 * Never edit the PNGs by hand: change the numbers here and run
 *
 *   node scripts/generate-brand-icons.js
 *
 * then prebuild so android/ picks them up. Uses pngjs (already installed).
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const INK = hex('#2F241B'); // markOuter
const CREAM = hex('#F7F0E6'); // base / splashGround
const OLIVE = hex('#8A6A00'); // markRing
const AMBER = hex('#DA8F00'); // markCore
const WHITE = [255, 255, 255];

const MASTER = 72;
// Outermost first: [diameter on the master, colour, is it part of the mark's ink?]
const LAYERS = [
  [72, INK, true],
  [54, CREAM, false],
  [40, OLIVE, true],
  [24, CREAM, false],
  [12, AMBER, true],
];

/**
 * @param size   image size in px
 * @param markD  outer diameter of the mark in px
 * @param ground [r,g,b] behind the mark, or null for transparent
 * @param mono   themed (monochrome) icon: ink parts white, cream parts see-through
 */
function draw(size, markD, ground, mono = false) {
  const png = new PNG({ width: size, height: size });
  const c = size / 2;
  const S = 4; // supersampling per axis — smooth edges at every size
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const d = Math.hypot(x + (sx + 0.5) / S - c, y + (sy + 0.5) / S - c) * 2 * (MASTER / markD);
          // The innermost layer this sample falls inside wins.
          let colour = null;
          for (const [diameter, fill, ink] of LAYERS) {
            if (d <= diameter) colour = mono ? (ink ? WHITE : null) : fill;
          }
          if (d > MASTER) colour = mono ? null : ground;
          if (colour) {
            r += colour[0]; g += colour[1]; b += colour[2]; a += 255;
          }
        }
      }
      const n = S * S;
      const i = (y * size + x) * 4;
      // Colour averaged over the covered samples; coverage becomes alpha.
      const covered = a / 255;
      png.data[i] = covered ? Math.round(r / covered) : 0;
      png.data[i + 1] = covered ? Math.round(g / covered) : 0;
      png.data[i + 2] = covered ? Math.round(b / covered) : 0;
      png.data[i + 3] = Math.round(a / n);
    }
  }
  return PNG.sync.write(png);
}

const out = (name, buf) => {
  fs.writeFileSync(path.join(__dirname, '..', 'assets', 'images', name), buf);
  console.log('wrote', name);
};

// Mark sizes match the previous files, so nothing moves on screen — only the
// proportions inside the mark are corrected.
out('icon.png', draw(1024, 614, CREAM));
out('android-icon-foreground.png', draw(512, 236, null));
out('android-icon-background.png', draw(512, 0, CREAM));
out('android-icon-monochrome.png', draw(512, 236, null, true));
out('splash-mark.png', draw(512, 470, null));
