"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Share2 } from "lucide-react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { formatCurrency, formatDateShort } from "@/lib/utils";
import {
  toWhatsAppDigits,
  type PartyStatement,
} from "@/lib/party-statement";
import type { Settings } from "@/types";
import { PartyStatementDocument } from "@/components/mobile/PartyStatementDocument";

const APP_FONT =
  'var(--font-cairo), Cairo, "Segoe UI", Tahoma, sans-serif';

function safeFileBase(name: string) {
  return name.replace(/[^\w\u0600-\u06FF-]+/g, "_") || "windoor";
}

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
  window.setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1500);
}

async function shareFile(blob: Blob, filename: string, title: string, text?: string) {
  const file = new File([blob], filename, { type: blob.type });
  const nav = typeof navigator !== "undefined" ? navigator : null;
  if (!nav?.share) {
    downloadBlob(blob, filename);
    return "downloaded";
  }

  const dataWithFiles: ShareData = { title, files: [file], text };
  const canFiles =
    typeof nav.canShare !== "function" || nav.canShare(dataWithFiles);

  try {
    if (canFiles) {
      await nav.share(dataWithFiles);
      return "shared";
    }
    await nav.share({ title, text: text || title });
    downloadBlob(blob, filename);
    return "shared-text";
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return "aborted";
    downloadBlob(blob, filename);
    return "downloaded";
  }
}

function canvasToPdf(canvas: HTMLCanvasElement) {
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const contentW = pageW - margin * 2;
  const contentH = pageH - margin * 2;
  const pxPerMm = canvas.width / contentW;
  const pageHeightPx = Math.max(1, Math.floor(contentH * pxPerMm));

  let y = 0;
  let page = 0;
  while (y < canvas.height - 1) {
    if (page > 0) pdf.addPage();
    const sliceH = Math.min(pageHeightPx, canvas.height - y);
    const slice = document.createElement("canvas");
    slice.width = canvas.width;
    slice.height = sliceH;
    const ctx = slice.getContext("2d");
    if (!ctx) throw new Error("تعذر إنشاء صفحة PDF");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(
      canvas,
      0,
      y,
      canvas.width,
      sliceH,
      0,
      0,
      canvas.width,
      sliceH
    );
    const imgH = sliceH / pxPerMm;
    pdf.addImage(slice.toDataURL("image/png"), "PNG", margin, margin, contentW, imgH);
    y += sliceH;
    page += 1;
    if (page > 40) break;
  }
  return pdf;
}

function whatsappText(statement: PartyStatement) {
  const period =
    statement.dateFrom && statement.dateTo
      ? `${formatDateShort(statement.dateFrom)} — ${formatDateShort(statement.dateTo)}`
      : "كل الفترة";
  return [
    statement.title,
    `الفترة: ${period}`,
    `الرصيد: ${formatCurrency(statement.closingBalance)}`,
  ].join("\n");
}

export function MobileStatementShare({
  statement,
  settings,
  showLines,
  disabled,
}: {
  statement: PartyStatement | null;
  settings: Settings | null;
  showLines: boolean;
  disabled?: boolean;
}) {
  const captureRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const issuedAt = useState(() => new Date())[0];

  async function buildPdf() {
    if (!statement || !captureRef.current) {
      throw new Error("لا توجد بيانات للكشف");
    }
    const canvas = await captureNode(captureRef.current);
    if (!canvas.width || !canvas.height) {
      throw new Error("تعذر رسم الكشف");
    }
    const pdf = canvasToPdf(canvas);
    const blob = pdf.output("blob");
    const name = `${safeFileBase(`كشف_${statement.party.name}`)}.pdf`;
    return { blob, name, title: statement.title };
  }

  async function run(action: "share" | "download" | "whatsapp") {
    if (!statement) return;
    setBusy(true);
    setError("");
    try {
      const { blob, name, title } = await buildPdf();
      const text = whatsappText(statement);
      if (action === "download") {
        downloadBlob(blob, name);
        return;
      }
      if (action === "whatsapp") {
        const digits = toWhatsAppDigits(statement.party.phone);
        const result = await shareFile(blob, name, title, text);
        if (result === "aborted") return;
        if (digits) {
          window.open(
            `https://wa.me/${digits}?text=${encodeURIComponent(text)}`,
            "_blank",
            "noopener,noreferrer"
          );
        }
        return;
      }
      await shareFile(blob, name, title, text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر التصدير");
    } finally {
      setBusy(false);
    }
  }

  const whatsappReady = Boolean(
    statement && toWhatsAppDigits(statement.party.phone)
  );

  return (
    <>
      {error ? (
        <p className="mb-3 text-sm font-bold text-[var(--danger)]">{error}</p>
      ) : null}
      <div className="grid grid-cols-1 gap-2">
        <button
          type="button"
          className="mobile-btn mobile-btn--primary"
          disabled={disabled || busy || !statement}
          onClick={() => void run("share")}
        >
          <Share2 className="h-4 w-4" />
          {busy ? "جاري التجهيز..." : "مشاركة PDF"}
        </button>
        <button
          type="button"
          className="mobile-btn mobile-btn--ghost"
          disabled={disabled || busy || !statement || !whatsappReady}
          onClick={() => void run("whatsapp")}
        >
          {whatsappReady ? "واتساب" : "واتساب — لا يوجد رقم"}
        </button>
        <button
          type="button"
          className="mobile-btn mobile-btn--ghost"
          disabled={disabled || busy || !statement}
          onClick={() => void run("download")}
        >
          <Download className="h-4 w-4" />
          تحميل PDF
        </button>
      </div>

      {typeof document !== "undefined" && statement
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
              <PartyStatementDocument
                statement={statement}
                settings={settings}
                showLines={showLines}
                issuedAt={issuedAt}
              />
            </div>,
            document.body
          )
        : null}
    </>
  );
}
