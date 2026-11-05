import type { StyleSpecification } from 'maplibre-gl';

/**
 * NEXT_PUBLIC_MAP_TILES_URL is an XYZ template (`{z}`, `{x}`, `{y}`).
 * NEXT_PUBLIC_MAP_TILE_ATTRIBUTION is the provider's HTML or plain credit.
 * A blank or invalid URL keeps the OpenStreetMap raster and attribution.
 */
export const OSM_TILES_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** Scheme, host, and port. No path, query, or `{z}` placeholder. */
export const OSM_TILE_ORIGIN = 'https://tile.openstreetmap.org';

export const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const XYZ_PLACEHOLDERS = ['{z}', '{x}', '{y}'] as const;

export type PassportMapStyleEnv = {
  tilesUrl?: string | null;
  attribution?: string | null;
};

function trimmed(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

/** http(s) XYZ template. Placeholders must be the literal `{z}`, `{x}`, and `{y}` tokens. */
export function isValidMapTilesUrl(raw: string | null | undefined): boolean {
  const value = trimmed(raw);
  if (!XYZ_PLACEHOLDERS.every((token) => value.includes(token))) return false;
  const probe = value.replaceAll('{z}', '0').replaceAll('{x}', '0').replaceAll('{y}', '0');
  try {
    const url = new URL(probe);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Origin the Passport map will request. A valid http(s) XYZ template contributes
 * its origin only. Blank, non-XYZ, and non-http(s) values use the OSM origin.
 * `{z}`, `{x}`, `{y}`, and any query (including a tile key) are not returned.
 */
export function mapTilesCspOrigin(raw: string | null | undefined): string {
  const value = trimmed(raw);
  if (!isValidMapTilesUrl(value)) return OSM_TILE_ORIGIN;
  const probe = value.replaceAll('{z}', '0').replaceAll('{x}', '0').replaceAll('{y}', '0');
  try {
    return new URL(probe).origin;
  } catch {
    return OSM_TILE_ORIGIN;
  }
}

function tileHost(tilesUrl: string): string | null {
  const probe = tilesUrl.replaceAll('{z}', '0').replaceAll('{x}', '0').replaceAll('{y}', '0');
  try {
    return new URL(probe).host;
  } catch {
    return null;
  }
}

/**
 * A custom URL with a blank attribution still uses that URL.
 * The credit names the tile host and does not say OpenStreetMap unless the
 * host is the public OSM tile host. Falling back to OSM tiles here would
 * hide a launch that forgot the required credit line.
 */
function attributionFor(tilesUrl: string, attribution: string): string {
  if (attribution) return attribution;
  const host = tileHost(tilesUrl);
  if (host === 'tile.openstreetmap.org') return OSM_ATTRIBUTION;
  return `Map tiles from ${host ?? 'configured tiles'}`;
}

export function passportMapStyle(env?: PassportMapStyleEnv): StyleSpecification {
  const tilesRaw = env && 'tilesUrl' in env ? env.tilesUrl : process.env.NEXT_PUBLIC_MAP_TILES_URL;
  const attributionRaw =
    env && 'attribution' in env
      ? env.attribution
      : process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION;
  const tilesUrl = trimmed(tilesRaw);
  const attribution = trimmed(attributionRaw);
  const custom = isValidMapTilesUrl(tilesUrl);

  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: [custom ? tilesUrl : OSM_TILES_URL],
        tileSize: 256,
        attribution: custom ? attributionFor(tilesUrl, attribution) : OSM_ATTRIBUTION,
      },
    },
    layers: [
      {
        id: 'osm',
        type: 'raster',
        source: 'osm',
        minzoom: 0,
        maxzoom: 19,
      },
    ],
  };
}
