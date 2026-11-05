import { afterEach, describe, expect, it } from 'vitest';
import type { StyleSpecification } from 'maplibre-gl';
import {
  OSM_ATTRIBUTION,
  OSM_TILE_ORIGIN,
  OSM_TILES_URL,
  mapTilesCspOrigin,
  passportMapStyle,
} from '@/lib/passport/map-style';

const URL_KEY = 'NEXT_PUBLIC_MAP_TILES_URL';
const ATTRIBUTION_KEY = 'NEXT_PUBLIC_MAP_TILE_ATTRIBUTION';

function raster(style: StyleSpecification) {
  const source = style.sources.osm;
  if (!source || source.type !== 'raster' || !source.tiles) {
    throw new Error('expected an osm raster source');
  }
  return source;
}

describe('passportMapStyle', () => {
  const previousUrl = process.env[URL_KEY];
  const previousAttribution = process.env[ATTRIBUTION_KEY];

  afterEach(() => {
    if (previousUrl === undefined) delete process.env[URL_KEY];
    else process.env[URL_KEY] = previousUrl;
    if (previousAttribution === undefined) delete process.env[ATTRIBUTION_KEY];
    else process.env[ATTRIBUTION_KEY] = previousAttribution;
  });

  it('uses the OpenStreetMap raster and attribution when neither env var is set', () => {
    delete process.env[URL_KEY];
    delete process.env[ATTRIBUTION_KEY];
    const source = raster(passportMapStyle());
    expect(source.tiles).toEqual([OSM_TILES_URL]);
    expect(source.tiles?.[0]).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(source.attribution).toBe(OSM_ATTRIBUTION);
    expect(source.attribution).toBe(
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    );
    expect(source.tileSize).toBe(256);
    expect(source.type).toBe('raster');
    const layer = passportMapStyle().layers[0];
    expect(layer).toMatchObject({ id: 'osm', type: 'raster', source: 'osm', minzoom: 0, maxzoom: 19 });
  });

  it('uses a custom XYZ template and the configured attribution', () => {
    const tilesUrl = 'https://example.test/{z}/{x}/{y}.png';
    const attribution = '© Example Tiles';
    process.env[URL_KEY] = tilesUrl;
    process.env[ATTRIBUTION_KEY] = attribution;
    const fromEnv = raster(passportMapStyle());
    expect(fromEnv.tiles?.[0]).toBe(tilesUrl);
    expect(fromEnv.attribution).toBe(attribution);

    const fromArgs = raster(passportMapStyle({ tilesUrl, attribution }));
    expect(fromArgs.tiles?.[0]).toBe(tilesUrl);
    expect(fromArgs.attribution).toBe(attribution);
    expect(fromArgs.tileSize).toBe(256);
  });

  it('falls back to OpenStreetMap when the URL is blank or invalid', () => {
    const invalid = [
      '',
      '   ',
      'https://example.test/tiles.png',
      'https://example.test/{z}/{x}.png',
      'notaurl/{z}/{x}/{y}',
      'ftp://example.test/{z}/{x}/{y}.png',
      'javascript:alert(1)/{z}/{x}/{y}',
    ];
    for (const tilesUrl of invalid) {
      const source = raster(
        passportMapStyle({ tilesUrl, attribution: '© Should be ignored' }),
      );
      expect(source.tiles).toEqual([OSM_TILES_URL]);
      expect(source.attribution).toBe(OSM_ATTRIBUTION);
    }
  });

  it('names the configured host when a custom URL has a blank attribution', () => {
    const source = raster(
      passportMapStyle({
        tilesUrl: 'https://tiles.example.test/maps/{z}/{x}/{y}.png',
        attribution: '  ',
      }),
    );
    expect(source.tiles?.[0]).toBe('https://tiles.example.test/maps/{z}/{x}/{y}.png');
    expect(source.attribution).toBe('Map tiles from tiles.example.test');
    expect(source.attribution).not.toMatch(/OpenStreetMap/);
  });

  it('returns the tile origin for CSP and falls back to OpenStreetMap', () => {
    expect(mapTilesCspOrigin(undefined)).toBe(OSM_TILE_ORIGIN);
    expect(mapTilesCspOrigin('')).toBe(OSM_TILE_ORIGIN);
    expect(mapTilesCspOrigin('   ')).toBe(OSM_TILE_ORIGIN);
    expect(mapTilesCspOrigin('https://example.test/tiles.png')).toBe(OSM_TILE_ORIGIN);
    expect(mapTilesCspOrigin('javascript:alert(1)/{z}/{x}/{y}')).toBe(OSM_TILE_ORIGIN);
    expect(mapTilesCspOrigin('ftp://example.test/{z}/{x}/{y}.png')).toBe(OSM_TILE_ORIGIN);
    expect(mapTilesCspOrigin(OSM_TILES_URL)).toBe('https://tile.openstreetmap.org');
    expect(
      mapTilesCspOrigin('https://api.maptiler.com/maps/streets/256/{z}/{x}/{y}.png?key=abc'),
    ).toBe('https://api.maptiler.com');
    expect(mapTilesCspOrigin('http://localhost:8080/tiles/{z}/{x}/{y}.png')).toBe(
      'http://localhost:8080',
    );
    const origin = mapTilesCspOrigin(
      'https://api.maptiler.com/maps/streets/256/{z}/{x}/{y}.png?key=abc',
    );
    expect(origin).not.toContain('key=abc');
    expect(origin).not.toContain('{z}');
    expect(origin).not.toContain('/maps/');
  });

  it('keeps the OpenStreetMap credit when the configured URL is that host and attribution is blank', () => {
    const source = raster(passportMapStyle({ tilesUrl: OSM_TILES_URL, attribution: '' }));
    expect(source.tiles).toEqual([OSM_TILES_URL]);
    expect(source.attribution).toBe(OSM_ATTRIBUTION);
  });
});
