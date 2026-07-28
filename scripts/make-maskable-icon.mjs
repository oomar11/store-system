/**
 * Build the Android/PWA maskable icon from the blue brand mark.
 * Maskable icons get cropped to a circle/squircle, so the logo is inset
 * inside the 80% safe zone on an opaque background.
 */
import sharp from "sharp";

const SIZE = 512;
const SAFE_RATIO = 0.62; // logo box relative to canvas
const SOURCE = "public/icons/icon-512.png";
const OUT = "public/icons/app-maskable-512.png";

const logoSize = Math.round(SIZE * SAFE_RATIO);

const logo = await sharp(SOURCE)
  .resize(logoSize, logoSize, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .toBuffer();

await sharp({
  create: {
    width: SIZE,
    height: SIZE,
    channels: 4,
    background: { r: 255, g: 255, b: 255, alpha: 1 },
  },
})
  .composite([{ input: logo, gravity: "center" }])
  .png()
  .toFile(OUT);

console.log(`wrote ${OUT} (${SIZE}x${SIZE}, logo ${logoSize}px)`);
