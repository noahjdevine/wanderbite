'use client';

import { useMemo, useState } from 'react';
import Map, { Layer, Marker, NavigationControl, Popup, Source } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MemoryEntryLink } from '@/components/notes/memory-entry';
import { LAUNCH_MARKET } from '@/lib/launch-market';
import { chicagoVisitDate, cuisineInk, MAP_SEGMENT_HREF, stampRotationDegrees } from '@/lib/passport/passport-board';
import { passportMapStyle } from '@/lib/passport/map-style';
import {
  boundsFromPoints,
  neighborhoodGlowPoints,
  routeLine,
  type MapPoint,
} from '@/lib/passport/passport-map';
import { visitStatusLabel } from '@/lib/visits/visit-status';

const mapStyle = passportMapStyle();

const LAUNCH = {
  longitude: LAUNCH_MARKET.centroid.lon,
  latitude: LAUNCH_MARKET.centroid.lat,
  zoom: 11,
};

const FOG = {
  type: 'Feature' as const,
  properties: {},
  geometry: {
    type: 'Polygon' as const,
    coordinates: [
      [
        [-179.9, -85],
        [179.9, -85],
        [179.9, 85],
        [-179.9, 85],
        [-179.9, -85],
      ],
    ],
  },
};

function pointCollection(points: readonly MapPoint[]) {
  return {
    type: 'FeatureCollection' as const,
    features: points.map((point) => ({
      type: 'Feature' as const,
      properties: { id: point.id },
      geometry: {
        type: 'Point' as const,
        coordinates: [point.longitude, point.latitude] as [number, number],
      },
    })),
  };
}

function MiniStamp({ point, selected }: { point: MapPoint; selected: boolean }) {
  const ink = cuisineInk(point.cuisineTags);
  const rotation = stampRotationDegrees(point.id);
  const face = chicagoVisitDate(point.verifiedAt)?.short ?? '';
  return (
    <span
      aria-hidden
      data-ink={ink.color}
      data-rotation={rotation}
      className="flex size-11 items-center justify-center rounded-full border-2 bg-white text-[9px] font-bold shadow-md"
      style={{
        color: ink.color,
        borderColor: ink.color,
        transform: `rotate(${rotation}deg)`,
        boxShadow: selected ? `0 0 0 4px ${ink.color}55` : undefined,
      }}
    >
      {face}
    </span>
  );
}

type PassportMapCanvasProps = {
  points: MapPoint[];
};

export function PassportMapMarkers({
  points,
  mapLib,
}: PassportMapCanvasProps & { mapLib?: unknown }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = points.find((point) => point.id === selectedId) ?? null;
  const glow = useMemo(() => neighborhoodGlowPoints(points), [points]);
  const line = useMemo(() => routeLine(points), [points]);
  const bounds = useMemo(() => boundsFromPoints(points), [points]);
  const initialViewState = useMemo(() => {
    if (bounds) {
      return { bounds, fitBoundsOptions: { padding: 56, maxZoom: 14 } };
    }
    return LAUNCH;
  }, [bounds]);

  return (
    <div className="wb-map-frame" role="region" aria-label="Visited restaurants" data-map-fog="static">
      <Map
        {...(mapLib ? { mapLib: mapLib as never } : {})}
        initialViewState={initialViewState}
        mapStyle={mapStyle}
        style={{ width: '100%', height: '100%' }}
        reuseMaps
        onClick={() => setSelectedId(null)}
      >
        <Source id="passport-fog" type="geojson" data={FOG}>
          <Layer
            id="passport-fog-fill"
            type="fill"
            paint={{ 'fill-color': '#2a1442', 'fill-opacity': 0.22 }}
          />
        </Source>
        <Source id="passport-neighborhoods" type="geojson" data={pointCollection(glow)}>
          <Layer
            id="passport-neighborhood-glow"
            type="circle"
            paint={{
              'circle-color': '#f6c453',
              'circle-opacity': 0.42,
              'circle-blur': 0.85,
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 46, 14, 110],
            }}
          />
        </Source>
        <Source id="passport-clearings" type="geojson" data={pointCollection(points)}>
          <Layer
            id="passport-visit-clearing"
            type="circle"
            paint={{
              'circle-color': '#fff6e8',
              'circle-opacity': 0.55,
              'circle-blur': 0.65,
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 28, 14, 72],
            }}
          />
        </Source>
        {line ? (
          <Source id="passport-route" type="geojson" data={line}>
            <Layer
              id="passport-route-line"
              type="line"
              layout={{ 'line-cap': 'round' }}
              paint={{
                'line-color': '#5b21b6',
                'line-width': 4,
                'line-dasharray': [0.6, 1.4],
              }}
            />
          </Source>
        ) : null}
        <NavigationControl position="top-right" showCompass={false} />
        {points.map((point) => {
          const spoken = chicagoVisitDate(point.verifiedAt)?.long ?? point.name;
          const label = `${point.name}, ${spoken}, ${visitStatusLabel(point.visitStatus)}`;
          return (
            <Marker key={point.id} longitude={point.longitude} latitude={point.latitude} anchor="center">
              <button
                type="button"
                aria-label={label}
                aria-pressed={selected?.id === point.id}
                className="cursor-pointer border-0 bg-transparent p-0"
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedId(point.id);
                }}
              >
                <MiniStamp point={point} selected={selected?.id === point.id} />
              </button>
            </Marker>
          );
        })}
        {selected ? (
          <Popup
            longitude={selected.longitude}
            latitude={selected.latitude}
            anchor="top"
            onClose={() => setSelectedId(null)}
            closeButton
            closeOnClick={false}
            maxWidth="240px"
          >
            <div className="space-y-1 p-1 text-sm text-[#241428]">
              <p className="m-0 font-semibold">{selected.name}</p>
              <p className="m-0 text-xs text-[#6b5f4b]">
                {chicagoVisitDate(selected.verifiedAt)?.long ?? ''}
              </p>
              {selected.neighborhood ? <p className="m-0 text-xs">{selected.neighborhood}</p> : null}
              <MemoryEntryLink
                status={selected.visitStatus}
                redemptionId={selected.id}
                returnTo={MAP_SEGMENT_HREF}
              />
            </div>
          </Popup>
        ) : null}
      </Map>
    </div>
  );
}

