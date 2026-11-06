import sharp from 'sharp';
import {
  RECEIPT_MAX_BYTES,
  RECEIPT_MAX_EDGE_PX,
  isReceiptContentType,
  type ReceiptContentType,
} from '@/lib/boost/receipt-limits';

export const RECEIPT_IMAGE_REFUSALS = [
  'unsupported_type',
  'too_large',
  'dimensions_too_large',
  'unreadable_image',
  'metadata_not_stripped',
] as const;

export type ReceiptImageRefusal = (typeof RECEIPT_IMAGE_REFUSALS)[number];

export type PreparedReceiptObject = {
  ok: true;
  bytes: Buffer;
  contentType: ReceiptContentType;
  byteSize: number;
  width: number;
  height: number;
};

export type PrepareReceiptResult =
  | PreparedReceiptObject
  | { ok: false; code: ReceiptImageRefusal };

const EXIF_SIGNATURE = Buffer.from('Exif\0\0');
const HEIF_BRANDS = new Set(['heic', 'heix', 'heif', 'mif1', 'msf1']);

type Box = {
  type: string;
  start: number;
  size: number;
  dataStart: number;
};

/**
 * JPEG, PNG, and WebP are re-encoded so EXIF and other metadata are dropped
 * and orientation is applied. The longest side is not reduced.
 * HEIC and HEIF are not transcoded. Dimensions come from the `ispe` box.
 * Exif item bytes are overwritten with zeros. If an Exif signature remains,
 * the upload is refused and nothing is stored.
 */
export async function prepareReceiptObject(
  bytes: Buffer,
  contentType: string,
): Promise<PrepareReceiptResult> {
  if (!isReceiptContentType(contentType)) return { ok: false, code: 'unsupported_type' };
  if (bytes.length > RECEIPT_MAX_BYTES) return { ok: false, code: 'too_large' };
  if (bytes.length === 0) return { ok: false, code: 'unreadable_image' };
  if (contentType === 'image/heic' || contentType === 'image/heif') {
    return prepareHeif(bytes, contentType);
  }
  if (!magicMatches(bytes, contentType)) return { ok: false, code: 'unreadable_image' };
  return prepareRaster(bytes, contentType);
}

function magicMatches(bytes: Buffer, contentType: ReceiptContentType): boolean {
  if (contentType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === 'image/png') {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  return (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  );
}

async function prepareRaster(
  bytes: Buffer,
  contentType: 'image/jpeg' | 'image/png' | 'image/webp',
): Promise<PrepareReceiptResult> {
  try {
    const input = sharp(bytes, { failOn: 'error' });
    const meta = await input.metadata();
    const expected = contentType === 'image/jpeg' ? 'jpeg' : contentType === 'image/png' ? 'png' : 'webp';
    if (meta.format !== expected) return { ok: false, code: 'unreadable_image' };
    const oriented = orientedSize(meta.width, meta.height, meta.orientation);
    if (!oriented) return { ok: false, code: 'unreadable_image' };
    if (oriented.width > RECEIPT_MAX_EDGE_PX || oriented.height > RECEIPT_MAX_EDGE_PX) {
      return { ok: false, code: 'dimensions_too_large' };
    }
    const pipeline = sharp(bytes, { failOn: 'error' }).rotate();
    const stripped =
      contentType === 'image/jpeg'
        ? await pipeline.jpeg({ quality: 90 }).toBuffer()
        : contentType === 'image/png'
          ? await pipeline.png().toBuffer()
          : await pipeline.webp({ quality: 90 }).toBuffer();
    if (stripped.length > RECEIPT_MAX_BYTES) return { ok: false, code: 'too_large' };
    const outMeta = await sharp(stripped, { failOn: 'error' }).metadata();
    if (!outMeta.width || !outMeta.height) return { ok: false, code: 'unreadable_image' };
    if (outMeta.width > RECEIPT_MAX_EDGE_PX || outMeta.height > RECEIPT_MAX_EDGE_PX) {
      return { ok: false, code: 'dimensions_too_large' };
    }
    if (outMeta.exif && outMeta.exif.length > 0) return { ok: false, code: 'metadata_not_stripped' };
    return {
      ok: true,
      bytes: stripped,
      contentType,
      byteSize: stripped.length,
      width: outMeta.width,
      height: outMeta.height,
    };
  } catch {
    return { ok: false, code: 'unreadable_image' };
  }
}

function orientedSize(
  width: number | undefined,
  height: number | undefined,
  orientation: number | undefined,
): { width: number; height: number } | null {
  if (!width || !height || width < 1 || height < 1) return null;
  if (orientation !== undefined && orientation >= 5 && orientation <= 8) {
    return { width: height, height: width };
  }
  return { width, height };
}

function prepareHeif(bytes: Buffer, contentType: 'image/heic' | 'image/heif'): PrepareReceiptResult {
  const top = readBoxes(bytes, 0, bytes.length);
  if (!top) return { ok: false, code: 'unreadable_image' };
  const ftyp = top.find((box) => box.type === 'ftyp');
  if (!ftyp || !heifBrand(bytes, ftyp)) return { ok: false, code: 'unreadable_image' };
  const extents = collectIspe(bytes, top);
  if (extents.length === 0) return { ok: false, code: 'unreadable_image' };
  if (extents.some((edge) => edge.width < 1 || edge.height < 1)) {
    return { ok: false, code: 'unreadable_image' };
  }
  if (extents.some((edge) => edge.width > RECEIPT_MAX_EDGE_PX || edge.height > RECEIPT_MAX_EDGE_PX)) {
    return { ok: false, code: 'dimensions_too_large' };
  }
  const primary = extents.reduce((best, edge) =>
    edge.width * edge.height > best.width * best.height ? edge : best,
  );
  const exifItems = collectExifItems(bytes, top);
  const ranges = exifRanges(
    bytes,
    top,
    exifItems.map((item) => item.id),
  );
  if (exifItems.length > 0 && ranges === null) return { ok: false, code: 'metadata_not_stripped' };
  const stripped = Buffer.from(bytes);
  for (const range of ranges ?? []) {
    if (range.start < 0 || range.end > stripped.length || range.end < range.start) {
      return { ok: false, code: 'metadata_not_stripped' };
    }
    stripped.fill(0, range.start, range.end);
  }
  for (const box of top) {
    if (box.type !== 'uuid' || box.dataStart + 16 > box.start + box.size) continue;
    stripped.fill(0, box.dataStart + 16, box.start + box.size);
  }
  // The infe item type is the 4cc "Exif". An empty item name plus the next
  // box's size byte can look like Exif\0\0. Ignore that type field. A real
  // leftover signature is a refusal.
  if (hasExifSignature(stripped, exifItems.map((item) => item.typeAt))) {
    return { ok: false, code: 'metadata_not_stripped' };
  }
  return {
    ok: true,
    bytes: stripped,
    contentType,
    byteSize: stripped.length,
    width: primary.width,
    height: primary.height,
  };
}

function heifBrand(bytes: Buffer, ftyp: Box): boolean {
  const end = ftyp.start + ftyp.size;
  if (ftyp.dataStart + 8 > end) return false;
  const major = bytes.toString('ascii', ftyp.dataStart, ftyp.dataStart + 4);
  if (HEIF_BRANDS.has(major)) return true;
  for (let offset = ftyp.dataStart + 8; offset + 4 <= end; offset += 4) {
    if (HEIF_BRANDS.has(bytes.toString('ascii', offset, offset + 4))) return true;
  }
  return false;
}

function collectIspe(bytes: Buffer, boxes: Box[]): { width: number; height: number }[] {
  const found: { width: number; height: number }[] = [];
  const walk = (list: Box[]) => {
    for (const box of list) {
      if (box.type === 'ispe') {
        const widthAt = box.dataStart + 4;
        const heightAt = widthAt + 4;
        if (heightAt + 4 <= box.start + box.size) {
          found.push({
            width: bytes.readUInt32BE(widthAt),
            height: bytes.readUInt32BE(heightAt),
          });
        }
        continue;
      }
      const children = childBoxes(bytes, box);
      if (children) walk(children);
    }
  };
  walk(boxes);
  return found;
}

function childBoxes(bytes: Buffer, box: Box): Box[] | null {
  if (box.type === 'meta') return readBoxes(bytes, box.dataStart + 4, box.start + box.size);
  if (box.type === 'iprp' || box.type === 'ipco') {
    return readBoxes(bytes, box.dataStart, box.start + box.size);
  }
  if (box.type === 'iinf') {
    const version = bytes[box.dataStart] ?? 0;
    const countBytes = version === 0 ? 2 : 4;
    return readBoxes(bytes, box.dataStart + 4 + countBytes, box.start + box.size);
  }
  return null;
}

function collectExifItems(bytes: Buffer, boxes: Box[]): { id: number; typeAt: number }[] {
  const items: { id: number; typeAt: number }[] = [];
  const walk = (list: Box[]) => {
    for (const box of list) {
      if (box.type === 'infe') {
        const item = exifItem(bytes, box);
        if (item) items.push(item);
        continue;
      }
      const children = childBoxes(bytes, box);
      if (children) walk(children);
    }
  };
  walk(boxes);
  return items;
}

function exifItem(bytes: Buffer, box: Box): { id: number; typeAt: number } | null {
  if (box.dataStart + 4 > box.start + box.size) return null;
  const version = bytes[box.dataStart] ?? 0;
  let cursor = box.dataStart + 4;
  let itemId: number;
  if (version >= 3) {
    if (cursor + 4 > box.start + box.size) return null;
    itemId = bytes.readUInt32BE(cursor);
    cursor += 4;
  } else if (version >= 2) {
    if (cursor + 2 > box.start + box.size) return null;
    itemId = bytes.readUInt16BE(cursor);
    cursor += 2;
  } else {
    return null;
  }
  cursor += 2;
  if (cursor + 4 > box.start + box.size) return null;
  const itemType = bytes.toString('ascii', cursor, cursor + 4);
  return itemType === 'Exif' ? { id: itemId, typeAt: cursor } : null;
}

function hasExifSignature(bytes: Buffer, ignoredStarts: number[]): boolean {
  const ignored = new Set(ignoredStarts);
  let from = 0;
  while (from < bytes.length) {
    const at = bytes.indexOf(EXIF_SIGNATURE, from);
    if (at < 0) return false;
    if (!ignored.has(at)) return true;
    from = at + 1;
  }
  return false;
}

function exifRanges(
  bytes: Buffer,
  boxes: Box[],
  itemIds: number[],
): { start: number; end: number }[] | null {
  if (itemIds.length === 0) return [];
  const wanted = new Set(itemIds);
  const iloc = findBox(bytes, boxes, 'iloc');
  if (!iloc) return null;
  const parsed = parseIloc(bytes, iloc);
  if (!parsed) return null;
  const ranges: { start: number; end: number }[] = [];
  for (const item of parsed) {
    if (!wanted.has(item.itemId)) continue;
    for (const extent of item.extents) {
      const base = item.baseOffset + extent.offset;
      const start = item.construction === 1 ? idatPayloadStart(bytes, boxes, base) : base;
      if (start === null) return null;
      ranges.push({ start, end: start + extent.length });
    }
    wanted.delete(item.itemId);
  }
  return wanted.size === 0 ? ranges : null;
}

function findBox(bytes: Buffer, boxes: Box[], type: string): Box | null {
  for (const box of boxes) {
    if (box.type === type) return box;
    const children = childBoxes(bytes, box);
    if (!children) continue;
    const found = findBox(bytes, children, type);
    if (found) return found;
  }
  return null;
}

function idatPayloadStart(bytes: Buffer, boxes: Box[], relative: number): number | null {
  const idat = findBox(bytes, boxes, 'idat');
  if (!idat) return null;
  const start = idat.dataStart + relative;
  if (start < idat.dataStart || start > idat.start + idat.size) return null;
  return start;
}

type IlocItem = {
  itemId: number;
  construction: number;
  baseOffset: number;
  extents: { offset: number; length: number }[];
};

function parseIloc(bytes: Buffer, box: Box): IlocItem[] | null {
  const end = box.start + box.size;
  if (box.dataStart + 6 > end) return null;
  const version = bytes[box.dataStart] ?? 0;
  let cursor = box.dataStart + 4;
  const offsetSize = bytes[cursor] >> 4;
  const lengthSize = bytes[cursor] & 0x0f;
  cursor += 1;
  const baseOffsetSize = bytes[cursor] >> 4;
  const indexSize = version === 1 || version === 2 ? bytes[cursor] & 0x0f : 0;
  cursor += 1;
  if (![0, 4, 8].includes(offsetSize) || ![0, 4, 8].includes(lengthSize) || ![0, 4, 8].includes(baseOffsetSize)) {
    return null;
  }
  const itemCount = version < 2 ? readUint(bytes, cursor, 2) : readUint(bytes, cursor, 4);
  if (itemCount === null) return null;
  cursor += version < 2 ? 2 : 4;
  const items: IlocItem[] = [];
  for (let index = 0; index < itemCount; index += 1) {
    const idSize = version < 2 ? 2 : 4;
    const itemId = readUint(bytes, cursor, idSize);
    if (itemId === null) return null;
    cursor += idSize;
    let construction = 0;
    if (version === 1 || version === 2) {
      const method = readUint(bytes, cursor, 2);
      if (method === null) return null;
      construction = method & 0x0f;
      cursor += 2;
    }
    if (readUint(bytes, cursor, 2) === null) return null;
    cursor += 2;
    const baseOffset = readUint(bytes, cursor, baseOffsetSize);
    if (baseOffset === null) return null;
    cursor += baseOffsetSize;
    const extentCount = readUint(bytes, cursor, 2);
    if (extentCount === null) return null;
    cursor += 2;
    const extents: { offset: number; length: number }[] = [];
    for (let extent = 0; extent < extentCount; extent += 1) {
      if (indexSize > 0) {
        if (readUint(bytes, cursor, indexSize) === null) return null;
        cursor += indexSize;
      }
      const offset = readUint(bytes, cursor, offsetSize);
      if (offset === null) return null;
      cursor += offsetSize;
      const length = readUint(bytes, cursor, lengthSize);
      if (length === null) return null;
      cursor += lengthSize;
      extents.push({ offset, length });
    }
    if (cursor > end) return null;
    items.push({ itemId, construction, baseOffset, extents });
  }
  return items;
}

function readUint(bytes: Buffer, offset: number, size: number): number | null {
  if (size === 0) return 0;
  if (offset + size > bytes.length) return null;
  if (size === 2) return bytes.readUInt16BE(offset);
  if (size === 4) return bytes.readUInt32BE(offset);
  if (size === 8) {
    const value = bytes.readBigUInt64BE(offset);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(value);
  }
  return null;
}

function readBoxes(bytes: Buffer, start: number, end: number): Box[] | null {
  if (start > end || end > bytes.length) return null;
  const boxes: Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) return null;
      const large = bytes.readBigUInt64BE(offset + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(large);
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) return null;
    if (!/^[ -~]{4}$/.test(type)) return null;
    boxes.push({ type, start: offset, size, dataStart: offset + header });
    offset += size;
  }
  if (offset !== end) return null;
  return boxes;
}
