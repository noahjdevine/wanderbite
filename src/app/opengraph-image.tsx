import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export const alt = 'Wanderbite — Dining adventures, curated for you.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background:
            'linear-gradient(135deg, #7c3aed 0%, #6d28d9 50%, #fb7185 100%)',
          color: 'white',
          padding: '64px',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div
          style={{
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            opacity: 0.85,
            marginBottom: 16,
          }}
        >
          Wanderbite
        </div>
        <div
          style={{
            fontSize: 72,
            fontWeight: 800,
            textAlign: 'center',
            lineHeight: 1.05,
            marginBottom: 24,
          }}
        >
          Dining Adventures,
          <br />
          Curated for You.
        </div>
        <div
          style={{
            fontSize: 30,
            opacity: 0.9,
            textAlign: 'center',
            maxWidth: '900px',
          }}
        >
          Two restaurant challenges every month. $10 off each.
        </div>
      </div>
    ),
    { ...size }
  );
}
