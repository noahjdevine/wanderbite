import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { MobileNav } from "@/components/layout/MobileNav";
import { MemberTabBarSlot } from "@/components/layout/member-tab-bar";

export default function SiteLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <Navbar />
      <MemberTabBarSlot>
        <div className="pt-14 xl:pt-0">{children}</div>
        <Footer />
      </MemberTabBarSlot>
      <MobileNav />
    </>
  );
}
