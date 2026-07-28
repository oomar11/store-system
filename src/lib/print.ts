const PRINT_A4_STYLE_ID = "print-a4-page-style";
const RECEIPT_IFRAME_ID = "receipt-print-frame";

const PRINT_A4_CSS = `@media print {
  @page {
    size: A4 portrait;
    margin: 9mm 7mm 13mm;
  }
}`;

function ensureA4PageStyle() {
  if (typeof document === "undefined") return;
  let el = document.getElementById(PRINT_A4_STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = PRINT_A4_STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = PRINT_A4_CSS;
}

function removeA4PageStyle() {
  if (typeof document === "undefined") return;
  document.getElementById(PRINT_A4_STYLE_ID)?.remove();
}

/** Toggle A4 page size for tabular report printing, then open the print dialog. */
export function printReport() {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  root.classList.add("print-a4");
  ensureA4PageStyle();

  const cleanup = () => {
    root.classList.remove("print-a4");
    removeA4PageStyle();
    window.removeEventListener("afterprint", cleanup);
  };

  window.addEventListener("afterprint", cleanup);
  window.print();

  window.setTimeout(cleanup, 2000);
}

/**
 * Self-contained receipt CSS — never copy app stylesheets.
 * App CSS brings body{min-height:100vh} and named @page rules that feed
 * a long blank lead on POS80 before the receipt starts.
 *
 * @page height MUST be auto: a fixed custom height gets letterboxed/centered
 * onto the driver's roll page, feeding blank paper before the receipt.
 */
function thermalReceiptCss(widthMm: 58 | 80): string {
  return `
@page {
  size: ${widthMm}mm auto;
  margin: 0 !important;
}
* { box-sizing: border-box; }
html, body {
  margin: 0 !important;
  padding: 0 !important;
  width: ${widthMm}mm !important;
  max-width: ${widthMm}mm !important;
  min-height: 0 !important;
  height: auto !important;
  background: #fff !important;
  color: #000 !important;
  overflow: visible !important;
  font-family: Tahoma, "Segoe UI", Arial, sans-serif !important;
  font-size: 12px !important;
  line-height: 1.35 !important;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
body {
  display: block !important;
}
.receipt-print-root,
.print-area {
  display: block !important;
  width: ${widthMm}mm !important;
  max-width: ${widthMm}mm !important;
  margin: 0 !important;
  padding: 0 !important;
  min-height: 0 !important;
  height: auto !important;
  position: static !important;
  background: #fff !important;
  color: #000 !important;
}
.print-area {
  padding: 1mm 2mm 2mm !important;
}
.print-paper {
  width: 100% !important;
  max-width: 100% !important;
  margin: 0 !important;
  padding: 0 !important;
  background: #fff !important;
  color: #000 !important;
}
.print-area, .print-area * {
  color: #000 !important;
  box-shadow: none !important;
  text-shadow: none !important;
  background: transparent !important;
  border-radius: 0 !important;
  page: auto !important;
  break-before: auto !important;
  page-break-before: auto !important;
}
/* Clean look: drop every stray border, then re-add only intended separators */
.print-area * {
  border: 0 !important;
}
.print-area svg { display: none !important; }
.no-print, .hidden { display: none !important; }

/* Intentional separators only */
.print-area .receipt-divider-top {
  border-top: 1px dashed #000 !important;
}
.print-area .receipt-divider-bottom {
  border-bottom: 1px dashed #000 !important;
}
.print-area .receipt-total-line {
  border-top: 2px solid #000 !important;
}
.print-area .receipt-item-sep {
  border-bottom: 0.5pt solid #000 !important;
}

/* Minimal utilities used by receipt markup */
.flex { display: flex !important; }
.flex-col { flex-direction: column !important; }
.items-center { align-items: center !important; }
.items-baseline { align-items: baseline !important; }
.justify-between { justify-content: space-between !important; }
.justify-center { justify-content: center !important; }
.text-center { text-align: center !important; }
.text-right { text-align: right !important; }
.text-left { text-align: left !important; }
.w-full { width: 100% !important; }
.shrink-0 { flex-shrink: 0 !important; }
.gap-1 { gap: 4px !important; }
.gap-2 { gap: 8px !important; }
.block { display: block !important; }
.font-bold, .font-semibold, .font-medium, .font-extrabold, .font-black {
  font-weight: 700 !important;
}
.leading-snug { line-height: 1.35 !important; }
.leading-tight { line-height: 1.25 !important; }
.space-y-0\\.5 > :not([hidden]) ~ :not([hidden]) { margin-top: 2px !important; }
.space-y-1 > :not([hidden]) ~ :not([hidden]) { margin-top: 4px !important; }
.space-y-1\\.5 > :not([hidden]) ~ :not([hidden]) { margin-top: 6px !important; }
.mt-0\\.5 { margin-top: 2px !important; }
.mt-1 { margin-top: 4px !important; }
.mt-1\\.5 { margin-top: 6px !important; }
.mt-2 { margin-top: 8px !important; }
.mt-4 { margin-top: 12px !important; }
.mb-1 { margin-bottom: 4px !important; }
.my-2 { margin-top: 8px !important; margin-bottom: 8px !important; }
.pt-1 { padding-top: 4px !important; }
.pt-1\\.5 { padding-top: 6px !important; }
.pt-2 { padding-top: 8px !important; }
.pt-2\\.5 { padding-top: 10px !important; }
.pb-1 { padding-bottom: 4px !important; }
.pb-1\\.5 { padding-bottom: 6px !important; }
.pb-2 { padding-bottom: 8px !important; }
.p-1\\.5 { padding: 6px !important; }
.p-2 { padding: 8px !important; }
.border { border: 1px solid #000 !important; }
.border-t { border-top: 1px solid #000 !important; }
.border-b { border-bottom: 1px solid #000 !important; }
.border-dashed { border-style: dashed !important; }
.border-double {
  border-top-style: double !important;
  border-top-width: 3px !important;
}
.border-b-2 { border-bottom: 2px solid #000 !important; }
.text-\\[8px\\], .text-\\[8\\.5px\\] { font-size: 8px !important; }
.text-\\[9px\\] { font-size: 9px !important; }
.text-\\[10px\\] { font-size: 10px !important; }
.text-\\[11px\\] { font-size: 11px !important; }
.text-xs { font-size: 12px !important; }
.text-sm { font-size: 13px !important; }
.text-base { font-size: 14px !important; }
.text-xl { font-size: 18px !important; }
.text-2xl { font-size: 20px !important; }
h1 { font-size: 18px !important; margin: 0 0 4px !important; font-weight: 800 !important; }
p { margin: 0 !important; }
img {
  max-height: 44px !important;
  max-width: 100% !important;
  object-fit: contain !important;
  display: block !important;
  margin-left: auto !important;
  margin-right: auto !important;
}
.receipt-line {
  break-inside: avoid !important;
  page-break-inside: avoid !important;
}
.print-copy-break {
  break-after: page;
  page-break-after: always;
}
.print-copy-break:last-child {
  break-after: auto;
  page-break-after: auto;
}
`;
}

/**
 * Print a thermal receipt via an isolated iframe (no app CSS).
 */
export function printReceiptElement(
  source: HTMLElement,
  widthMm: 58 | 80 = 80
): void {
  if (typeof document === "undefined") return;

  document.getElementById(RECEIPT_IFRAME_ID)?.remove();

  const iframe = document.createElement("iframe");
  iframe.id = RECEIPT_IFRAME_ID;
  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("title", "طباعة إيصال");
  Object.assign(iframe.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: `${widthMm}mm`,
    height: "100px",
    border: "0",
    margin: "0",
    padding: "0",
    opacity: "0",
    pointerEvents: "none",
    zIndex: "-1",
  });
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    return;
  }

  doc.open();
  doc.write(`<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8" />
<style id="thermal-receipt-style">
${thermalReceiptCss(widthMm)}
</style>
</head>
<body>
  <div class="receipt-print-root">
    <div class="print-area">
${source.innerHTML}
    </div>
  </div>
</body>
</html>`);
  doc.close();

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    win.removeEventListener("afterprint", cleanup);
    iframe.remove();
  };

  const triggerPrint = () => {
    const area = doc.querySelector(".print-area") as HTMLElement | null;
    if (!area) {
      cleanup();
      return;
    }

    // Grow iframe so content renders full height before printing
    iframe.style.height = `${Math.max(area.scrollHeight + 32, 80)}px`;

    try {
      win.focus();
      win.print();
    } finally {
      win.addEventListener("afterprint", cleanup);
      window.setTimeout(cleanup, 60_000);
    }
  };

  window.requestAnimationFrame(() => {
    window.setTimeout(triggerPrint, 50);
  });
}
