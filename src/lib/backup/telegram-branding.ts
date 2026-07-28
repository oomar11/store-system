import sharp from "sharp";
import { createServiceClient } from "@/lib/supabase-service";

export type BotBrandingResult = {
  name_ok: boolean;
  photo_ok: boolean;
  description_ok: boolean;
  name?: string;
  errors: string[];
};

async function tgApi(
  token: string,
  method: string,
  body?: BodyInit,
  headers?: HeadersInit
): Promise<{ ok: boolean; description?: string }> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers,
    body,
  });
  const data = (await res.json()) as { ok: boolean; description?: string };
  return { ok: data.ok, description: data.description };
}

async function loadStoreBranding() {
  const client = createServiceClient();
  const { data } = await client
    .from("settings")
    .select("store_name, logo_url")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return {
    store_name: (data?.store_name || "ويندور").trim().slice(0, 64),
    logo_url: (data?.logo_url || "").trim() || null,
  };
}

async function resolveProfileJpeg(
  logoUrl: string | null
): Promise<Buffer | null> {
  const urlCandidates: string[] = [];
  if (logoUrl) urlCandidates.push(logoUrl);

  const site =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

  if (site) {
    urlCandidates.push(`${site.replace(/\/$/, "")}/icon.png`);
    urlCandidates.push(`${site.replace(/\/$/, "")}/icons/icon-512.png`);
  }

  urlCandidates.push("https://store-system-iota.vercel.app/icon.png");
  urlCandidates.push(
    "https://store-system-iota.vercel.app/icons/icon-512.png"
  );

  let source: Buffer | null = null;
  for (const url of urlCandidates) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.byteLength > 100) {
          source = buf;
          break;
        }
      }
    } catch (e) {
      console.error("fetch branding image", url, e);
    }
  }

  if (!source) return null;

  try {
    return await sharp(source)
      .rotate()
      .resize(640, 640, { fit: "cover", position: "centre" })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
  } catch (e) {
    console.error("sharp convert", e);
    return null;
  }
}

/** Apply store name + logo to the Telegram bot profile. */
export async function syncTelegramBotBranding(
  token: string
): Promise<BotBrandingResult> {
  const errors: string[] = [];
  const branding = await loadStoreBranding();
  const name = branding.store_name;

  const nameRes = await tgApi(
    token,
    "setMyName",
    JSON.stringify({ name }),
    { "Content-Type": "application/json" }
  );
  if (!nameRes.ok) {
    errors.push(nameRes.description || "فشل تغيير اسم البوت");
  }

  // Arabic-specific name as well
  const nameArRes = await tgApi(
    token,
    "setMyName",
    JSON.stringify({ name, language_code: "ar" }),
    { "Content-Type": "application/json" }
  );
  if (!nameArRes.ok && nameArRes.description) {
    // non-fatal if default name already set
    console.warn("setMyName ar", nameArRes.description);
  }

  const shortDesc = `نسخ احتياطي تلقائي — ${name}`.slice(0, 120);
  const desc = `بوت النسخ الاحتياطي لنظام ${name}. يستقبل نسخ البيانات اليومية.`.slice(
    0,
    512
  );

  const shortRes = await tgApi(
    token,
    "setMyShortDescription",
    JSON.stringify({ short_description: shortDesc }),
    { "Content-Type": "application/json" }
  );
  const descRes = await tgApi(
    token,
    "setMyDescription",
    JSON.stringify({ description: desc }),
    { "Content-Type": "application/json" }
  );

  const description_ok = shortRes.ok || descRes.ok;
  if (!shortRes.ok && shortRes.description) {
    errors.push(shortRes.description);
  }

  let photo_ok = false;
  const jpeg = await resolveProfileJpeg(branding.logo_url);
  if (jpeg) {
    const form = new FormData();
    form.append(
      "photo",
      JSON.stringify({ type: "static", photo: "attach://profile" })
    );
    form.append(
      "profile",
      new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }),
      "profile.jpg"
    );

    const photoRes = await tgApi(token, "setMyProfilePhoto", form);
    photo_ok = photoRes.ok;
    if (!photoRes.ok) {
      errors.push(photoRes.description || "فشل تغيير صورة البوت");
    }
  } else {
    errors.push("لم يتم العثور على صورة للبوت (لوجو المحل أو أيقونة النظام)");
  }

  return {
    name_ok: nameRes.ok,
    photo_ok,
    description_ok,
    name,
    errors,
  };
}
