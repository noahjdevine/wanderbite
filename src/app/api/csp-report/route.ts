import { NextResponse } from 'next/server';
import {
  clientIpFromRequest,
  evaluateCspReportIntake,
  parseCspReportBody,
} from '@/lib/csp-report';

export const dynamic = 'force-dynamic';

function emptyAck(status = 204): NextResponse {
  return new NextResponse(null, { status });
}

export async function POST(request: Request): Promise<NextResponse> {
  const raw = await request.arrayBuffer();
  const intake = await evaluateCspReportIntake({
    byteLength: raw.byteLength,
    ip: clientIpFromRequest(request),
  });

  if (intake === 'too_large') {
    return emptyAck(413);
  }
  if (intake !== 'allow') {
    return emptyAck();
  }

  const text = new TextDecoder('utf-8', { fatal: false }).decode(raw);
  const reports = parseCspReportBody(text);
  if (!reports) {
    return emptyAck();
  }

  console.warn('[csp-report]', JSON.stringify(reports));
  return emptyAck();
}

export function GET(): NextResponse {
  return new NextResponse(null, { status: 405, headers: { Allow: 'POST' } });
}
