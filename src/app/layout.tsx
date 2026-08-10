import type { Metadata, Viewport } from "next";
import { Cairo } from "next/font/google";
import { PWARegister } from "@/components/PWARegister";
import { ThemeAwareAppIcon } from "@/components/ThemeAwareAppIcon";
import { OfflineProvider } from "@/components/offline/OfflineProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import "./globals.css";

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
});

const themeInitScript = `(function(){try{var k='windoor-theme';var t=localStorage.getItem(k);if(t!=='light'&&t!=='dark'&&t!=='system')t='system';var r=t==='system'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):t;document.documentElement.setAttribute('data-theme',r);document.documentElement.style.colorScheme=r;}catch(e){}})();`;

export const metadata: Metadata = {
  title: "ويندور - Windoor",
  description: "نظام إدارة المخزون والحسابات - ويندور",
  manifest: "/manifest.json?v=16",
  icons: {
    icon: [
      {
        url: "/icons/app-favicon.ico",
        sizes: "48x48",
        type: "image/x-icon",
      },
      {
        url: "/icons/app-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        url: "/icons/app-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/icons/app-apple-180.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
    shortcut: [
      {
        url: "/icons/app-favicon.ico",
      },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ويندور",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Allow pinch-zoom for accessibility (was locked at 1)
  maximumScale: 5,
  userScalable: true,
  themeColor: "#1473e6",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${cairo.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <link
          rel="icon"
          href="/icons/app-favicon.ico"
          sizes="48x48"
          type="image/x-icon"
        />
        <link
          rel="icon"
          href="/icons/app-192.png"
          sizes="192x192"
          type="image/png"
        />
        <link
          rel="icon"
          href="/icons/app-512.png"
          sizes="512x512"
          type="image/png"
        />
        <link rel="apple-touch-icon" href="/icons/app-apple-180.png" />
      </head>
      <body className="min-h-full bg-background font-[var(--font-cairo)] antialiased">
        <ThemeProvider>
          <ToastProvider>
            <ConfirmProvider>
              <OfflineProvider>
                {children}
                <ThemeAwareAppIcon />
                <PWARegister />
              </OfflineProvider>
            </ConfirmProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
