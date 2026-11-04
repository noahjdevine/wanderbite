import type { ReactNode } from 'react';
import { ReadingFrame } from '@/components/reading/reading-frame';

export default function TermsReadingLayout({ children }: { children: ReactNode }) {
  return <ReadingFrame>{children}</ReadingFrame>;
}
