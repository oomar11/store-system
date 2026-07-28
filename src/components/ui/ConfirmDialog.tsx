"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export type ConfirmTone = "default" | "danger";

export type ConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
};

export type PromptOptions = {
  title?: string;
  message: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  placeholder?: string;
};

export type ChoiceOptions = {
  title?: string;
  message: string;
  primaryLabel: string;
  dangerLabel: string;
  cancelLabel?: string;
};

export type ChoiceResult = "primary" | "danger" | "cancel";

type ConfirmContextValue = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
  choice: (options: ChoiceOptions) => Promise<ChoiceResult>;
};

type PendingConfirm = ConfirmOptions & {
  kind: "confirm";
  resolve: (value: boolean) => void;
};

type PendingPrompt = PromptOptions & {
  kind: "prompt";
  resolve: (value: string | null) => void;
};

type PendingChoice = ChoiceOptions & {
  kind: "choice";
  resolve: (value: ChoiceResult) => void;
};

type Pending = PendingConfirm | PendingPrompt | PendingChoice;

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

let imperativeConfirm: ConfirmContextValue["confirm"] | null = null;
let imperativePrompt: ConfirmContextValue["prompt"] | null = null;
let imperativeChoice: ConfirmContextValue["choice"] | null = null;

/** Works outside React components (falls back to window.confirm). */
export async function appConfirm(options: ConfirmOptions): Promise<boolean> {
  if (imperativeConfirm) return imperativeConfirm(options);
  if (typeof window === "undefined") return false;
  return window.confirm(
    options.title ? `${options.title}\n\n${options.message}` : options.message
  );
}

/** Works outside React components (falls back to window.prompt). */
export async function appPrompt(options: PromptOptions): Promise<string | null> {
  if (imperativePrompt) return imperativePrompt(options);
  if (typeof window === "undefined") return null;
  return window.prompt(
    options.title ? `${options.title}\n\n${options.message}` : options.message,
    options.defaultValue ?? ""
  );
}

/** Three-action dialog for flows like logout-with-open-shift. */
export async function appChoice(options: ChoiceOptions): Promise<ChoiceResult> {
  if (imperativeChoice) return imperativeChoice(options);
  if (typeof window === "undefined") return "cancel";
  const primary = window.confirm(
    `${options.title || "تأكيد"}\n\n${options.message}\n\nموافق = ${options.primaryLabel}`
  );
  if (primary) return "primary";
  const danger = window.confirm(
    `${options.dangerLabel}؟\nاضغط موافق للمتابعة أو إلغاء للرجوع.`
  );
  return danger ? "danger" : "cancel";
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, kind: "confirm", resolve });
    });
  }, []);

  const prompt = useCallback((options: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      setPromptValue(options.defaultValue ?? "");
      setPending({ ...options, kind: "prompt", resolve });
    });
  }, []);

  const choice = useCallback((options: ChoiceOptions) => {
    return new Promise<ChoiceResult>((resolve) => {
      setPending({ ...options, kind: "choice", resolve });
    });
  }, []);

  useEffect(() => {
    imperativeConfirm = confirm;
    imperativePrompt = prompt;
    imperativeChoice = choice;
    return () => {
      if (imperativeConfirm === confirm) imperativeConfirm = null;
      if (imperativePrompt === prompt) imperativePrompt = null;
      if (imperativeChoice === choice) imperativeChoice = null;
    };
  }, [confirm, prompt, choice]);

  useEffect(() => {
    if (!pending) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (pending.kind === "confirm") pending.resolve(false);
        else if (pending.kind === "prompt") pending.resolve(null);
        else pending.resolve("cancel");
        setPending(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [pending]);

  useEffect(() => {
    if (pending?.kind === "prompt") {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [pending]);

  const value = useMemo(
    () => ({ confirm, prompt, choice }),
    [confirm, prompt, choice]
  );

  function closeConfirm(result: boolean) {
    if (!pending || pending.kind !== "confirm") return;
    pending.resolve(result);
    setPending(null);
  }

  function closePrompt(result: string | null) {
    if (!pending || pending.kind !== "prompt") return;
    pending.resolve(result);
    setPending(null);
  }

  function closeChoice(result: ChoiceResult) {
    if (!pending || pending.kind !== "choice") return;
    pending.resolve(result);
    setPending(null);
  }

  const tone = pending?.kind === "confirm" ? pending.tone || "default" : "default";
  const confirmLabel =
    pending?.kind === "confirm" || pending?.kind === "prompt"
      ? pending.confirmLabel ||
        (tone === "danger"
          ? "حذف"
          : pending?.kind === "prompt"
            ? "موافق"
            : "تأكيد")
      : "تأكيد";
  const cancelLabel =
    pending?.kind === "choice"
      ? pending.cancelLabel || "إلغاء"
      : pending?.cancelLabel || "إلغاء";

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {mounted &&
        pending &&
        createPortal(
          <div
            className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
            role="presentation"
          >
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="app-confirm-title"
              aria-describedby="app-confirm-message"
              className="app-theme w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_24px_60px_rgba(15,23,42,0.28)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-b border-[var(--border)] px-5 py-4">
                <h2
                  id="app-confirm-title"
                  className="text-base font-bold text-[var(--foreground)]"
                >
                  {pending.title ||
                    (pending.kind === "prompt"
                      ? "إدخال"
                      : pending.kind === "choice"
                        ? "اختر إجراء"
                        : tone === "danger"
                          ? "تأكيد الحذف"
                          : "تأكيد")}
                </h2>
              </div>
              <div className="space-y-4 px-5 py-4">
                <p
                  id="app-confirm-message"
                  className="whitespace-pre-line text-sm leading-relaxed text-[var(--muted)]"
                >
                  {pending.message}
                </p>
                {pending.kind === "prompt" && (
                  <input
                    ref={inputRef}
                    value={promptValue}
                    onChange={(e) => setPromptValue(e.target.value)}
                    placeholder={pending.placeholder}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        closePrompt(promptValue);
                      }
                    }}
                    className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-subtle)] px-3 py-2.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[color-mix(in_srgb,var(--primary)_40%,transparent)]"
                  />
                )}
              </div>
              <div
                className={cn(
                  "flex gap-2 border-t border-[var(--border)] bg-[var(--surface-subtle)] px-5 py-3",
                  pending.kind === "choice" && "flex-col"
                )}
              >
                {pending.kind === "choice" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => closeChoice("primary")}
                      className="min-h-11 w-full rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-bold text-white hover:bg-[var(--primary-dark)]"
                    >
                      {pending.primaryLabel}
                    </button>
                    <button
                      type="button"
                      onClick={() => closeChoice("danger")}
                      className="min-h-11 w-full rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-700"
                    >
                      {pending.dangerLabel}
                    </button>
                    <button
                      type="button"
                      onClick={() => closeChoice("cancel")}
                      className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--surface-subtle)]"
                    >
                      {cancelLabel}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        pending.kind === "confirm"
                          ? closeConfirm(true)
                          : closePrompt(promptValue)
                      }
                      className={cn(
                        "min-h-11 flex-1 rounded-xl px-4 py-2.5 text-sm font-bold text-white",
                        tone === "danger"
                          ? "bg-red-600 hover:bg-red-700"
                          : "bg-[var(--primary)] hover:bg-[var(--primary-dark)]"
                      )}
                    >
                      {confirmLabel}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        pending.kind === "confirm"
                          ? closeConfirm(false)
                          : closePrompt(null)
                      }
                      className="min-h-11 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--surface-subtle)]"
                    >
                      {cancelLabel}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    return {
      confirm: appConfirm,
      prompt: appPrompt,
      choice: appChoice,
    };
  }
  return ctx;
}
