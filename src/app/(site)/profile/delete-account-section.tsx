'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { deleteAccount } from '@/app/actions/auth';

export function DeleteAccountSection() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleConfirm() {
    setIsDeleting(true);
    try {
      const result = await deleteAccount();
      if (result.ok) {
        await createClient().auth.signOut();
        router.push('/');
        router.refresh();
        return;
      }
      // Could set error state and show in UI; for now rely on toast or re-open dialog with message
      setIsDeleting(false);
      setOpen(false);
    } catch {
      setIsDeleting(false);
      setOpen(false);
    }
  }

  return (
    <>
      <section className="mt-12 border-t border-red-200 pt-8">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-red-600 px-1">
          Danger Zone
        </h3>
        <p className="mt-2 text-sm text-muted-foreground px-1">
          Permanently delete your account and all associated data. This cannot be undone.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
        >
          Delete Account
        </button>
      </section>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action is permanent and deletes all your data. You will not be able to recover
              your account or any associated content.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleConfirm();
              }}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting…' : 'Yes, delete my account'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
