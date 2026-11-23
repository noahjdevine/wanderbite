import { Footer } from '@/components/layout/Footer';
import { MemberTabBarSlot } from '@/components/layout/member-tab-bar';
import { MobileNav } from '@/components/layout/MobileNav';
import { Navbar } from '@/components/layout/Navbar';
import { siteProblemReportsEnabled } from '@/lib/site-problems/flag';

export default function AccountLayout({
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
