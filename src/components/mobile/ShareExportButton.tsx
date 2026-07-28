"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Share2 } from "lucide-react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { MobileSheet } from "@/components/mobile/MobileUI";

export type ShareLine = {
  title: string;
  subtitle?: string;
  amount: string;
};

export type SharePayload = {
  title: string;
  subtitle?: string;
  totalLabel?: string;
  total: string;
  metaLines?: string[];
  lines: ShareLine[];
  notes?: string | null;
  fileBaseName: string;
};

type Props = {
  payload: SharePayload | null;
  disabled?: boolean;
};

function safeFileBase(name: string) {
  return name.replace(/[^\w\u0600-\u06FF-]+/g, "_") || "windoor";
}

/** Same stack as the app body (Cairo via next/font). */
const APP_FONT =
  'var(--font-cairo), Cairo, "Segoe UI", Tahoma, sans-serif';

function resolveAppFontFamily() {
  if (typeof document === "undefined") return APP_FONT;
  const fromBody = getComputedStyle(document.body).fontFamily;
  if (fromBody && fromBody !== "serif" && fromBody !== "sans-serif") {
    return fromBody;
  }
  const fromVar = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-cairo")
    .trim();
  if (fromVar) return `${fromVar}, Cairo, Tahoma, sans-serif`;
  return APP_FONT;
}

async function captureNode(el: HTMLElement) {
  const prev = {
    left: el.style.left,
    top: el.style.top,
    opacity: el.style.opacity,
    zIndex: el.style.zIndex,
    pointerEvents: el.style.pointerEvents,
  };

  // Theme-colored veil so the white capture card never flashes over dark UI.
  // Capture stays in-viewport under the veil (off-screen capture blanked before).
  const mask = document.createElement("div");
  mask.setAttribute("aria-hidden", "true");
  const themeBg =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--background")
      .trim() || "#0f1623";
  Object.assign(mask.style, {
    position: "fixed",
    inset: "0",
    zIndex: "100000",
    background: themeBg,
    pointerEvents: "none",
  });
  document.body.appendChild(mask);

  el.style.left = "0";
  el.style.top = "0";
  el.style.opacity = "1";
  el.style.zIndex = "99999";
  el.style.pointerEvents = "none";

  // Ensure Cairo (next/font) is ready before rasterizing.
  try {
    await document.fonts.ready;
  } catch {
    /* ignore */
  }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const fontFamily = resolveAppFontFamily();

  try {
    return await html2canvas(el, {
      backgroundColor: "#ffffff",
      scale: Math.min(2, window.devicePixelRatio || 2),
      useCORS: true,
      allowTaint: true,
      logging: false,
      width: el.scrollWidth,
      height: el.scrollHeight,
      windowWidth: el.scrollWidth,
      windowHeight: el.scrollHeight,
      onclone(_doc, cloned) {
        const root = cloned as HTMLElement;
        root.style.fontFamily = fontFamily;
        root.querySelectorAll<HTMLElement>("*").forEach((node) => {
          node.style.fontFamily = fontFamily;
        });
      },
    });
  } finally {
    el.style.left = prev.left;
    el.style.top = prev.top;
    el.style.opacity = prev.opacity;
    el.style.zIndex = prev.zIndex;
    el.style.pointerEvents = prev.pointerEvents;
    mask.remove();
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  // Delay revoke so the download can start; avoid navigating the current tab.
  window.setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1500);
}

async function shareFile(blob: Blob, filename: string, title: string) {
  const file = new File([blob], filename, { type: blob.type });
  const nav = typeof navigator !== "undefined" ? navigator : null;
  if (!nav?.share) {
    downloadBlob(blob, filename);
    return;
  }

  const dataWithFiles: ShareData = { title, files: [file] };
  const canFiles =
    typeof nav.canShare !== "function" || nav.canShare(dataWithFiles);

  try {
    if (canFiles) {
      await nav.share(dataWithFiles);
      return;
    }
    // Fallback: share without files (some browsers)
    await nav.share({ title, text: title });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return;
    downloadBlob(blob, filename);
  }
}

function CapturePreview({ payload }: { payload: SharePayload }) {
  return (
    <div
      dir="rtl"
      style={{
        position: "relative",
        width: 390,
        padding: 20,
        paddingBottom: 24,
        background: "#ffffff",
        color: "#142033",
        fontFamily: APP_FONT,
        boxSizing: "border-box",
        overflow: "hidden",
        border: "2px solid #1473e6",
        textAlign: "right",
        direction: "rtl",
      }}
    >
      <div style={{ position: "relative", zIndex: 1 }}>
        <div
          style={{
            marginBottom: 14,
            paddingBottom: 12,
            borderBottom: "2px solid #e2e9f2",
          }}
        >
          <div
            style={{
              fontWeight: 800,
              fontSize: 16,
              lineHeight: 1.4,
            }}
          >
            {payload.title}
          </div>
          {payload.subtitle ? (
            <div
              style={{
                fontSize: 12,
                color: "#526176",
                fontWeight: 600,
                marginTop: 4,
                lineHeight: 1.4,
              }}
            >
              {payload.subtitle}
            </div>
          ) : null}
        </div>

        <div
          style={{
            borderRadius: 12,
            border: "1px solid #c4cedb",
            padding: 14,
            marginBottom: 14,
            background: "rgba(248, 251, 255, 0.55)",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: "#526176" }}>
            {payload.totalLabel || "الإجمالي"}
          </div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 800,
              marginTop: 4,
              direction: "ltr",
              unicodeBidi: "plaintext",
              textAlign: "right",
            }}
          >
            {payload.total}
          </div>
          {(payload.metaLines || []).map((line) => (
            <div
              key={line}
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "#526176",
                marginTop: 4,
                lineHeight: 1.45,
              }}
            >
              {line}
            </div>
          ))}
        </div>

        <div
          style={{
            border: "1px solid #c4cedb",
            borderRadius: 12,
            overflow: "hidden",
            background: "rgba(255,255,255,0.45)",
          }}
        >
          {payload.lines.length === 0 ? (
            <div style={{ padding: 12, fontSize: 13, color: "#66758a" }}>
              لا توجد بنود
            </div>
          ) : (
            payload.lines.map((line, i) => (
              <div
                key={`${line.title}-${i}`}
                dir="rtl"
                style={{
                  display: "flex",
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "10px 12px",
                  borderBottom:
                    i === payload.lines.length - 1
                      ? "none"
                      : "1px solid #e2e9f2",
                }}
              >
                <div style={{ minWidth: 0, flex: 1, textAlign: "right" }}>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 13,
                      lineHeight: 1.4,
                    }}
                  >
                    {line.title}
                  </div>
                  {line.subtitle ? (
                    <div
                      style={{
                        fontSize: 11,
                        color: "#66758a",
                        marginTop: 2,
                        lineHeight: 1.4,
                      }}
                    >
                      {line.subtitle}
                    </div>
                  ) : null}
                </div>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: 13,
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                    direction: "ltr",
                    unicodeBidi: "plaintext",
                  }}
                >
                  {line.amount}
                </div>
              </div>
            ))
          )}
        </div>

        {payload.notes ? (
          <div
            style={{
              marginTop: 12,
              fontSize: 12,
              fontWeight: 600,
              color: "#526176",
              lineHeight: 1.45,
            }}
          >
            {payload.notes}
          </div>
        ) : null}

        <div
          style={{
            marginTop: 16,
            paddingTop: 10,
            borderTop: "1px dashed #c4cedb",
            textAlign: "center",
            fontSize: 11,
            fontWeight: 700,
            color: "#66758a",
          }}
        >
          ويندور
        </div>
      </div>

      {/* Text watermark overlay — above content, no logo */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: "-25%",
          zIndex: 2,
          pointerEvents: "none",
          transform: "rotate(-28deg)",
          display: "flex",
          flexWrap: "wrap",
          gap: "40px 52px",
          alignContent: "flex-start",
          justifyContent: "center",
          opacity: 0.09,
        }}
      >
        {Array.from({ length: 28 }).map((_, i) => (
          <span
            key={i}
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: "#1473e6",
              whiteSpace: "nowrap",
              fontFamily: APP_FONT,
            }}
          >
            ويندور
          </span>
        ))}
      </div>
    </div>
  );
}

export function ShareExportButton({ payload, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const captureRef = useRef<HTMLDivElement>(null);

  async function exportAs(kind: "png" | "pdf", mode: "share" | "download") {
    if (!payload || !captureRef.current) {
      setError("لا توجد بيانات للمشاركة");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const canvas = await captureNode(captureRef.current);
      if (!canvas.width || !canvas.height) {
        throw new Error("تعذر رسم المحتوى");
      }
      const base = safeFileBase(payload.fileBaseName);

      if (kind === "png") {
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/png")
        );
        if (!blob) throw new Error("تعذر إنشاء الصورة");
        const name = `${base}.png`;
        if (mode === "share") await shareFile(blob, name, payload.title);
        else downloadBlob(blob, name);
      } else {
        const img = canvas.toDataURL("image/png");
        const pdf = new jsPDF({
          orientation: "portrait",
          unit: "mm",
          format: "a4",
        });
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        const margin = 10;
        const maxW = pageW - margin * 2;
        const maxH = pageH - margin * 2;
        const ratio = Math.min(maxW / canvas.width, maxH / canvas.height);
        const w = canvas.width * ratio;
        const h = canvas.height * ratio;
        pdf.addImage(img, "PNG", margin, margin, w, h);
        const blob = pdf.output("blob");
        const name = `${base}.pdf`;
        if (mode === "share") await shareFile(blob, name, payload.title);
        else downloadBlob(blob, name);
      }
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر التصدير");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="mobile-icon-btn"
        disabled={disabled || !payload}
        aria-label="مشاركة"
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      >
        <Share2 className="h-5 w-5" />
      </button>

      <MobileSheet
        open={open}
        title="مشاركة"
        onClose={() => !busy && setOpen(false)}
      >
        {error ? (
          <p className="mb-3 text-sm font-bold text-[var(--danger)]">{error}</p>
        ) : null}

        <div className="space-y-2">
          <button
            type="button"
            className="mobile-btn mobile-btn--primary"
            disabled={busy || !payload}
            onClick={() => exportAs("png", "share")}
          >
            <Share2 className="h-4 w-4" />
            {busy ? "جاري التجهيز..." : "مشاركة صورة"}
          </button>
          <button
            type="button"
            className="mobile-btn mobile-btn--ghost"
            disabled={busy || !payload}
            onClick={() => exportAs("pdf", "share")}
          >
            <Share2 className="h-4 w-4" />
            مشاركة PDF
          </button>
          <button
            type="button"
            className="mobile-btn mobile-btn--ghost"
            disabled={busy || !payload}
            onClick={() => exportAs("png", "download")}
          >
            <Download className="h-4 w-4" />
            تحميل صورة
          </button>
          <button
            type="button"
            className="mobile-btn mobile-btn--ghost"
            disabled={busy || !payload}
            onClick={() => exportAs("pdf", "download")}
          >
            <Download className="h-4 w-4" />
            تحميل PDF
          </button>
        </div>
      </MobileSheet>

      {/* Always mounted capture surface (portal) — not inside the sheet */}
      {typeof document !== "undefined" && payload
        ? createPortal(
            <div
              ref={captureRef}
              aria-hidden
              style={{
                position: "fixed",
                left: 0,
                top: 0,
                opacity: 0,
                pointerEvents: "none",
                zIndex: -1,
              }}
            >
              <CapturePreview payload={payload} />
            </div>,
            document.body
          )
        : null}
    </>
  );
}
