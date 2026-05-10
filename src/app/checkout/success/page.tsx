import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { CheckoutSuccessClient } from '@/components/checkout/checkout-success-client';

export const dynamic = 'force-dynamic';

export default async function CheckoutSuccessPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/signin?redirectTo=/checkout/success');
  }

  return <CheckoutSuccessClient />;
}
