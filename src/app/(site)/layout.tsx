import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { MobileNav } from "@/components/layout/MobileNav";
import { MemberTabBarSlot } from "@/components/layout/member-tab-bar";
import { siteProblemReportsEnabled } from "@/lib/site-problems/flag";

export default function SiteLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const reportProblems = siteProblemReportsEnabled();
  return (
    <>
      <Navbar reportProblems={reportProblems} />
      <MemberTabBarSlot>
        <div className="pt-14 xl:pt-0">{children}</div>
        <Footer reportProblems={reportProblems} />
      </MemberTabBarSlot>
      <MobileNav reportProblems={reportProblems} />
    </>
  );
}
