import { spawnSync } from "node:child_process";
import { createSerwistRoute } from "@serwist/turbopack";

const revision =
  spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).stdout?.trim() ||
  crypto.randomUUID();

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    additionalPrecacheEntries: [
      { url: "/~offline", revision },
      { url: "/app-start.html", revision },
      { url: "/offline.html", revision },
      { url: "/manifest.json", revision },
      { url: "/login", revision },
      { url: "/pos", revision },
      { url: "/dashboard", revision },
      { url: "/products", revision },
      { url: "/customers", revision },
      { url: "/m", revision },
      { url: "/m/pos", revision },
      // Do not precache /m/finance or /m/parties — phones were keeping a
      // stale bundle that still required invoices to cover supplier pay.
      { url: "/offline-queue", revision },
    ],
    swSrc: "src/app/sw.ts",
    useNativeEsbuild: true,
  });
