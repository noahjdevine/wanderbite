import { Footer } from '@/components/layout/Footer';
import { MemberTabBarSlot } from '@/components/layout/member-tab-bar';
import { MobileNav } from '@/components/layout/MobileNav';
import { Navbar } from '@/components/layout/Navbar';

export default function AccountLayout({
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
