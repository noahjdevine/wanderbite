import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { MobileNav } from "@/components/layout/MobileNav";
import { OnboardingModal } from "@/components/onboarding/onboarding-modal";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Wanderbite",
  description: "Dining adventures, curated for you.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${outfit.variable} font-sans antialiased pb-20 md:pb-0`}
      >
        <Navbar />
        {children}
        <Footer />
        <MobileNav />
        <OnboardingModal />
        <Toaster />
      </body>
    </html>
  );
}
