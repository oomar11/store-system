/**
 * Minimal Code 128-B barcode encoder → SVG string (no external deps).
 * Suitable for product SKU labels and thermal/A4 printing.
 */

/** Code 128 patterns for values 0–106 (Start B = 104, Stop = 106 uses STOP_PATTERN). */
const CODE128: string[] = [
  "11011001100", "11001101100", "11001100110", "10010011000", "10010001100",
  "10001001100", "10011001000", "10011000100", "10001100100", "11001001000",
  "11001000100", "11000100100", "10110011100", "10011011100", "10011001110",
  "10111001100", "10011101100", "10011100110", "11001110010", "11001011100",
  "11001001110", "11011100100", "11001110100", "11101101110", "11101001100",
  "11100101100", "11100100110", "11101100100", "11100110100", "11100110010",
  "11011011000", "11011000110", "11000110110", "10100011000", "10001011000",
  "10001000110", "10110001000", "10001101000", "10001100010", "11010001000",
  "11000101000", "11000100010", "10110111000", "10110001110", "10001101110",
  "10111011000", "10111000110", "10001110110", "11101110110", "11010001110",
  "11000101110", "11011101000", "11011100010", "11011101110", "11101011000",
  "11101000110", "11100010110", "11101101000", "11101100010", "11100011010",
  "11101111010", "11001000010", "11110001010", "10100110000", "10100001100",
  "10010110000", "10010000110", "10000101100", "10000100110", "10110010000",
  "10110000100", "10011010000", "10011000010", "10000110100", "10000110010",
  "11000010010", "11001010000", "11110111010", "11000010100", "10001111010",
  "10100111100", "10010111100", "10010011110", "10111100100", "10011110100",
  "10011110010", "11110100100", "11110010100", "11110010010", "11011011110",
  "11011110110", "11110110110", "10101111000", "10100011110", "10001011110",
  "10111101000", "10111100010", "11110101000", "11110100010", "10111011110",
  "10111101110", "11101011110", "11110101110", "11010000100", "11010010000",
  "11010011100", "1100011101011",
];

const START_B = 104;

function charValue(ch: string): number {
  const code = ch.charCodeAt(0);
  if (code < 32 || code > 127) {
    throw new Error(`رمز غير مدعوم في الباركود: ${ch}`);
  }
  return code - 32;
}

/** Encode text as Code 128-B; returns array of module bits (1=bar, 0=space). */
export function encodeCode128B(text: string): number[] {
  const clean = String(text || "").trim();
  if (!clean) throw new Error("الكود فارغ");
  if (clean.length > 48) throw new Error("الكود طويل جداً للملصق");

  const values = [START_B];
  for (const ch of clean) {
    values.push(charValue(ch));
  }
  let checksum = START_B;
  for (let i = 1; i < values.length; i++) {
    checksum += values[i] * i;
  }
  values.push(checksum % 103);
  values.push(106); // Stop

  const bits: number[] = [];
  for (const v of values) {
    const pattern = CODE128[v];
    if (!pattern) throw new Error("تعذر ترميز الباركود");
    for (const c of pattern) bits.push(c === "1" ? 1 : 0);
  }
  return bits;
}

export function barcodeToSvg(
  text: string,
  opts?: { height?: number; moduleWidth?: number; showText?: boolean }
): string {
  const height = opts?.height ?? 48;
  const moduleWidth = opts?.moduleWidth ?? 1.6;
  const showText = opts?.showText !== false;
  const bits = encodeCode128B(text);
  const width = bits.length * moduleWidth;
  const textH = showText ? 14 : 0;
  const totalH = height + textH + 4;

  let x = 0;
  const rects: string[] = [];
  for (const bit of bits) {
    if (bit === 1) {
      rects.push(
        `<rect x="${x.toFixed(2)}" y="0" width="${moduleWidth}" height="${height}" fill="#000"/>`
      );
    }
    x += moduleWidth;
  }

  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(1)}" height="${totalH}" viewBox="0 0 ${width.toFixed(1)} ${totalH}" role="img" aria-label="${escaped}">
  ${rects.join("")}
  ${
    showText
      ? `<text x="${(width / 2).toFixed(1)}" y="${height + 12}" text-anchor="middle" font-family="ui-monospace,monospace" font-size="11" fill="#000">${escaped}</text>`
      : ""
  }
</svg>`;
}

export function isLikelyBarcodeScan(term: string): boolean {
  const t = term.trim();
  if (t.length < 4) return false;
  return /^[A-Za-z0-9\-_.]+$/.test(t) && !/\s/.test(t);
}
