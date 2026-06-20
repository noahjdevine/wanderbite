import { Footer } from '@/components/layout/Footer';
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
      <div className="pt-14 md:pt-0">{children}</div>
      <Footer />
      <MobileNav />
    </>
  );
}
