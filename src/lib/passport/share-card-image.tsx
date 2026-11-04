import type { ReactElement } from 'react';
import {
  PASSPORT_SHARE_IMAGE_HEIGHT,
  PASSPORT_SHARE_IMAGE_WIDTH,
  type PassportShareCardModel,
  type PassportShareCardStamp,
} from '@/lib/passport/share-card';

const NIGHT = '#120a24';
const CREAM = '#faf6ef';
const INK = '#1f1530';
const PLUM = '#2a1442';
const LAVENDER = '#ddd6fe';
const BLUSH = '#ffc9d6';

function countLine(model: PassportShareCardModel): string | null {
  const parts = [model.visitLabel, model.restaurantLabel, model.neighborhoodLabel].filter(
    (part): part is string => Boolean(part),
  );
  if (parts.length === 0) return null;
  return parts.join(' · ');
}

function StampMark({ stamp }: { stamp: PassportShareCardStamp }) {
  const ink = stamp.inkColor;
  const round = stamp.shape === 'round';
  return (
    <div
      style={{
        display: 'flex',
        width: 280,
        height: 280,
        alignItems: 'center',
        justifyContent: 'center',
        transform: `rotate(${stamp.rotation}deg)`,
      }}
    >
      <div
        style={{
          display: 'flex',
          width: round ? 248 : 250,
          height: round ? 248 : 220,
          borderRadius: round ? 124 : 16,
          border: `6px solid ${ink}`,
          background: CREAM,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 10,
        }}
      >
        <div
          style={{
            display: 'flex',
            width: '100%',
            height: '100%',
            borderRadius: round ? 110 : 10,
            border: round ? `3px dashed ${ink}` : `3px solid ${ink}`,
            color: ink,
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 12,
          }}
        >
          <div style={{ display: 'flex', fontSize: 15, fontWeight: 700, letterSpacing: 1.4 }}>
            WANDERBITE
          </div>
          <div
            style={{
              display: 'flex',
              marginTop: 10,
              fontSize: 28,
              lineHeight: 1.05,
              textAlign: 'center',
            }}
          >
            {stamp.name}
          </div>
          <div
            style={{
              display: 'flex',
              width: '70%',
              marginTop: 10,
              borderTop: `2px solid ${ink}`,
            }}
          />
          <div style={{ display: 'flex', marginTop: 10, fontSize: 22, fontWeight: 700 }}>
            {stamp.dateLabel}
          </div>
          {stamp.neighborhood ? (
            <div style={{ display: 'flex', marginTop: 6, fontSize: 16, fontWeight: 700 }}>
              {stamp.neighborhood}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Golden Hour passport card. next/og draws this with its default font. */
export function passportShareImageElement(model: PassportShareCardModel): ReactElement {
  const counts = countLine(model);
  const status = model.levelLabel ?? model.badgeLabel;
  return (
    <div
      style={{
        width: PASSPORT_SHARE_IMAGE_WIDTH,
        height: PASSPORT_SHARE_IMAGE_HEIGHT,
        display: 'flex',
        flexDirection: 'column',
        background: NIGHT,
        color: CREAM,
        padding: 56,
      }}
    >
      <div
        style={{
          display: 'flex',
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: 4,
          color: LAVENDER,
        }}
      >
        WANDERBITE
      </div>
      <div style={{ display: 'flex', marginTop: 18, fontSize: 76, lineHeight: 0.95 }}>
        {model.title}
      </div>
      {status ? (
        <div style={{ display: 'flex', marginTop: 18, fontSize: 30, color: BLUSH }}>{status}</div>
      ) : null}
      {counts ? (
        <div style={{ display: 'flex', marginTop: 16, fontSize: 28 }}>{counts}</div>
      ) : null}
      <div
        style={{
          display: 'flex',
          flexGrow: 1,
          flexDirection: 'column',
          marginTop: 36,
          borderRadius: 40,
          background: CREAM,
          color: INK,
          border: `4px solid ${PLUM}`,
          padding: 28,
        }}
      >
        {model.empty ? (
          <div
            style={{
              display: 'flex',
              flexGrow: 1,
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div style={{ display: 'flex', fontSize: 48, color: PLUM }}>No stamps yet</div>
            <div style={{ display: 'flex', marginTop: 16, fontSize: 26, color: '#6b6275' }}>
              Verified visits show up here.
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              alignContent: 'center',
              flexGrow: 1,
            }}
          >
            {model.stamps.map((stamp) => (
              <StampMark key={`${stamp.name}-${stamp.dateLabel}-${stamp.rotation}`} stamp={stamp} />
            ))}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', marginTop: 28, fontSize: 28, letterSpacing: 0.4 }}>
        {model.footer}
      </div>
    </div>
  );
}
