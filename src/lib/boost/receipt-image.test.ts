import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { prepareReceiptObject } from '@/lib/boost/receipt-image';
import { RECEIPT_MAX_BYTES, RECEIPT_MAX_EDGE_PX } from '@/lib/boost/receipt-limits';

const TOKEN = 'SECRET_EXIF_TOKEN';

async function jpegWithExif(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 40, b: 60 } },
  })
    .jpeg()
    .withMetadata({ exif: { IFD0: { ImageDescription: TOKEN } } })
    .toBuffer();
}

function box(type: string, payload: Buffer): Buffer {
  const out = Buffer.alloc(8 + payload.length);
  out.writeUInt32BE(out.length, 0);
  out.write(type, 4, 'ascii');
  payload.copy(out, 8);
  return out;
}

function fullBox(type: string, version: number, payload: Buffer): Buffer {
  const head = Buffer.alloc(4 + payload.length);
  head.writeUInt8(version, 0);
  payload.copy(head, 4);
  return box(type, head);
}

function syntheticHeic(width: number, height: number, extraExif = false): Buffer {
  const ftypPayload = Buffer.alloc(16);
  ftypPayload.write('heic', 0);
  ftypPayload.write('heic', 8);
  ftypPayload.write('mif1', 12);
  const ispeBody = Buffer.alloc(8);
  ispeBody.writeUInt32BE(width, 0);
  ispeBody.writeUInt32BE(height, 4);
  const iprp = box('iprp', box('ipco', fullBox('ispe', 0, ispeBody)));
  const infeBody = Buffer.alloc(9);
  infeBody.writeUInt16BE(1, 0);
  infeBody.write('Exif', 4);
  const count = Buffer.alloc(2);
  count.writeUInt16BE(1, 0);
  const iinf = fullBox('iinf', 0, Buffer.concat([count, fullBox('infe', 2, infeBody)]));
  const exif = Buffer.concat([Buffer.from('Exif\0\0'), Buffer.from(TOKEN)]);
  const ilocBody = Buffer.alloc(18);
  ilocBody[0] = 0x44;
  ilocBody.writeUInt16BE(1, 2);
  ilocBody.writeUInt16BE(1, 4);
  ilocBody.writeUInt16BE(1, 8);
  const iloc = fullBox('iloc', 0, ilocBody);
  const meta = fullBox('meta', 0, Buffer.concat([iinf, iloc, iprp]));
  const ftyp = box('ftyp', ftypPayload);
  const offset = ftyp.length + meta.length + 8;
  ilocBody.writeUInt32BE(offset, 10);
  ilocBody.writeUInt32BE(exif.length, 14);
  const metaFixed = fullBox('meta', 0, Buffer.concat([iinf, fullBox('iloc', 0, ilocBody), iprp]));
  const parts = [ftyp, metaFixed, box('mdat', exif)];
  if (extraExif) parts.push(box('free', Buffer.from('Exif\0\0')));
  return Buffer.concat(parts);
}

describe('receipt images', () => {
  it('strips JPEG EXIF and keeps the pixel size', async () => {
    const input = await jpegWithExif(16, 8);
    expect(input.includes(Buffer.from(TOKEN))).toBe(true);
    const prepared = await prepareReceiptObject(input, 'image/jpeg');
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.width).toBe(16);
    expect(prepared.height).toBe(8);
    expect(prepared.byteSize).toBe(prepared.bytes.length);
    expect(prepared.bytes.includes(Buffer.from(TOKEN))).toBe(false);
    expect(prepared.contentType).toBe('image/jpeg');
    const meta = await sharp(prepared.bytes).metadata();
    expect(meta.exif).toBeUndefined();
  });

  it('strips PNG and WebP metadata', async () => {
    for (const contentType of ['image/png', 'image/webp'] as const) {
      const encoded =
        contentType === 'image/png'
          ? await sharp({
              create: { width: 12, height: 10, channels: 3, background: { r: 1, g: 2, b: 3 } },
            })
              .png()
              .withMetadata({ exif: { IFD0: { ImageDescription: TOKEN } } })
              .toBuffer()
          : await sharp({
              create: { width: 12, height: 10, channels: 3, background: { r: 1, g: 2, b: 3 } },
            })
              .webp()
              .withMetadata({ exif: { IFD0: { ImageDescription: TOKEN } } })
              .toBuffer();
      const prepared = await prepareReceiptObject(encoded, contentType);
      expect(prepared.ok, contentType).toBe(true);
      if (!prepared.ok) return;
      expect(prepared.bytes.includes(Buffer.from(TOKEN))).toBe(false);
      expect(prepared.width).toBe(12);
      expect(prepared.height).toBe(10);
    }
  });

  it('zeroes a HEIC Exif item and refuses one that still carries a signature', async () => {
    const prepared = await prepareReceiptObject(syntheticHeic(64, 48), 'image/heic');
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.width).toBe(64);
    expect(prepared.height).toBe(48);
    expect(prepared.contentType).toBe('image/heic');
    expect(prepared.bytes.includes(Buffer.from(TOKEN))).toBe(false);
    expect(prepared.bytes.includes(Buffer.concat([Buffer.from('Exif\0\0'), Buffer.from(TOKEN)]))).toBe(false);

    const heif = await prepareReceiptObject(syntheticHeic(20, 20), 'image/heif');
    expect(heif.ok).toBe(true);

    const leftover = await prepareReceiptObject(syntheticHeic(20, 20, true), 'image/heic');
    expect(leftover).toEqual({ ok: false, code: 'metadata_not_stripped' });
  });

  it('refuses an edge over 8000 pixels and does not return a smaller image', async () => {
    const wide = await jpegWithExif(RECEIPT_MAX_EDGE_PX + 1, 1);
    const refused = await prepareReceiptObject(wide, 'image/jpeg');
    expect(refused).toEqual({ ok: false, code: 'dimensions_too_large' });
    expect(JSON.stringify(refused)).not.toContain(TOKEN);

    const atCap = await jpegWithExif(RECEIPT_MAX_EDGE_PX, 1);
    const kept = await prepareReceiptObject(atCap, 'image/jpeg');
    expect(kept.ok).toBe(true);
    if (!kept.ok) return;
    expect(kept.width).toBe(RECEIPT_MAX_EDGE_PX);
    expect(kept.height).toBe(1);

    const heic = await prepareReceiptObject(syntheticHeic(8001, 10), 'image/heic');
    expect(heic).toEqual({ ok: false, code: 'dimensions_too_large' });
  });

  it('refuses an over-cap buffer and a type outside the allowlist', async () => {
    const huge = Buffer.alloc(RECEIPT_MAX_BYTES + 1);
    expect(await prepareReceiptObject(huge, 'image/jpeg')).toEqual({ ok: false, code: 'too_large' });
    expect(await prepareReceiptObject(Buffer.from('gif'), 'image/gif')).toEqual({
      ok: false,
      code: 'unsupported_type',
    });
  });
});
