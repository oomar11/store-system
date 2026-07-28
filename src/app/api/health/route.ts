import { NextResponse } from "next/server";

/** Lightweight connectivity probe — never cached by the service worker as a static asset. */
export async function GET() {
  return NextResponse.json(
    { ok: true, t: Date.now() },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}
