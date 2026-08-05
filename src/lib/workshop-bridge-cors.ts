import { NextResponse } from "next/server";

/** CORS for UPVC workshop (aa) browser calls into store bridge APIs. */
export const WORKSHOP_BRIDGE_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, x-workshop-bridge-secret",
};

export function withWorkshopCors(response: NextResponse) {
  for (const [key, value] of Object.entries(WORKSHOP_BRIDGE_CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

export function workshopCorsPreflight() {
  return withWorkshopCors(new NextResponse(null, { status: 204 }));
}
