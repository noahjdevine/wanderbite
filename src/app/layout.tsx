import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Outfit } from "next/font/google";
import { PostHogProvider } from "@/components/providers/posthog-provider";
import { RecoveryRedirect } from "@/components/auth/recovery-redirect";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

/** Display face for Golden Hour. Not applied to body, and not preloaded, so pages that don't use it don't fetch it. */
const instrumentSerif = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
  adjustFontFallback: true,
  preload: false,
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://wanderbite.co"
  ),
  title: {
    default: "Wanderbite — Dining adventures, curated for you.",
    template: "%s · Wanderbite",
  },
  description:
    "Stop arguing about where to eat. Get two curated restaurant challenges a month in McKinney, Texas, and discover your next favorite spot.",
  icons: {
    icon: "/Wanderbite-logo.svg",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "WanderBite",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    type: "website",
    siteName: "Wanderbite",
    title: "Wanderbite — Dining adventures, curated for you.",
    description:
      "Two curated restaurant challenges every month in McKinney, Texas. Earn badges as you explore.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Wanderbite — Dining adventures, curated for you.",
    description: "Two curated restaurant challenges every month in McKinney, Texas.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={instrumentSerif.variable}>
      <body className={`${outfit.variable} font-sans antialiased`}>
        <PostHogProvider>
          <RecoveryRedirect />
          {children}
          <Toaster />
        </PostHogProvider>
      </body>
    </html>
  );
}
