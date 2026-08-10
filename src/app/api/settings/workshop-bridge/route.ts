import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/backup/auth";
import { createServiceClient } from "@/lib/supabase-service";
import {
  clearWorkshopBridgeSecretCache,
  isWorkshopBridgeConfigured,
  resolveWorkshopBridgeSecret,
} from "@/lib/workshop-bridge";

export const runtime = "nodejs";

const BRIDGE_CONFIG_ID = "c0000000-0000-0000-0000-000000000001";
const REVOKED = "windoor-workshop-bridge-2026-rho";

function maskSecret(secret: string): string {
  if (!secret) return "";
  if (secret.length <= 8) return "••••••••";
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

function sanitizeNewSecret(raw: string): string {
  const secret = raw.trim();
  if (!secret || secret.length < 16) {
    throw new Error("المفتاح لازم يكون 16 حرف على الأقل");
  }
  if (secret === REVOKED) {
    throw new Error("هذا المفتاح مُبطَل — ولّد مفتاح جديد");
  }
  return secret;
}

function envSource(): "env" | "db" | "none" {
  const envRaw =
    process.env.WORKSHOP_BRIDGE_SECRET?.trim() ||
    process.env.STORE_WORKSHOP_BRIDGE_SECRET?.trim() ||
    "";
  if (envRaw && envRaw !== REVOKED) return "env";
  return "none";
}

export async function GET() {
  const auth = await requirePermission(
    "settings",
    "ليس لديك صلاحية لإعدادات جسر الورش"
  );
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  try {
    const configured = await isWorkshopBridgeConfigured();
    const secret = configured ? await resolveWorkshopBridgeSecret() : "";
    const sourcePref = envSource();
    const source =
      sourcePref === "env" ? "env" : configured ? "db" : "none";

    return NextResponse.json({
      ok: true,
      configured,
      source,
      secret_masked: maskSecret(secret),
      env_overrides_db: sourcePref === "env",
      hint:
        sourcePref === "env"
          ? "المفتاح مضبوط من متغير WORKSHOP_BRIDGE_SECRET على Vercel — ده اللي بيتستخدم حالياً"
          : configured
            ? "المفتاح محفوظ في قاعدة البيانات — انسخه للورش من زر التوليد أو أعد التوليد"
            : "الجسر مش مضبوط — ولّد مفتاح واحفظه ثم الصقه في ورشة PVC والبليسيه",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "فشل التحميل";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission(
    "settings",
    "ليس لديك صلاحية لإعدادات جسر الورش"
  );
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      secret?: string;
    };
    const action = body.action === "save" ? "save" : "generate";

    let secret: string;
    if (action === "generate") {
      secret = randomBytes(24).toString("hex");
    } else {
      secret = sanitizeNewSecret(String(body.secret || ""));
    }

    const client = await createServiceClient();
    const { error } = await client.from("workshop_bridge_config").upsert(
      {
        id: BRIDGE_CONFIG_ID,
        bridge_secret: secret,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
    if (error) throw new Error(error.message);

    clearWorkshopBridgeSecretCache();

    const envOverrides = envSource() === "env";

    return NextResponse.json({
      ok: true,
      configured: !envOverrides || true,
      source: envOverrides ? "env" : "db",
      env_overrides_db: envOverrides,
      secret,
      secret_masked: maskSecret(secret),
      warning: envOverrides
        ? "تم الحفظ في القاعدة، لكن Vercel WORKSHOP_BRIDGE_SECRET لسه هو الفعّال — احذف المتغير أو حدّثه بنفس المفتاح"
        : null,
      message: envOverrides
        ? "اتحفظ المفتاح في القاعدة لكن المتغير على Vercel بيتقدّم عليه"
        : "تم حفظ مفتاح الجسر — انسخه الآن والصقه في الورش",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "فشل الحفظ";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
