import type { ReactNode } from 'react';
import { ReadingFrame } from '@/components/reading/reading-frame';

export default function ContactReadingLayout({ children }: { children: ReactNode }) {
  return <ReadingFrame>{children}</ReadingFrame>;
}
