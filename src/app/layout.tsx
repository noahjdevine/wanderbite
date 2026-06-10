import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";
import { PostHogProvider } from "@/components/providers/posthog-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
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
    "Stop arguing about where to eat. Get two curated restaurant challenges a month, save $10 at each, and discover your next favorite spot.",
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
      "Two curated restaurant challenges every month. $10 off each. Earn badges as you explore.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Wanderbite — Dining adventures, curated for you.",
    description: "Two curated restaurant challenges every month. $10 off each.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${outfit.variable} font-sans antialiased`}>
        <PostHogProvider>
          {children}
          <Toaster />
        </PostHogProvider>
      </body>
    </html>
  );
}
