import { redirect } from "next/navigation";

/**
 * Fallback only — middleware normally rewrites `/` to login/dashboard
 * with a 200 (SW-safe). Keep a server redirect if middleware is bypassed.
 */
export default function Home() {
  redirect("/login?next=/dashboard");
}
