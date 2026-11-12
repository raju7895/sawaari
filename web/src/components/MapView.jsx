import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useTheme } from '../context/ThemeContext';

const makeIcon = (type, busy) =>
  L.divIcon({
    className: '',
    html: `<div class="sw-marker ${type} ${busy ? 'busy' : ''} ${type === 'driver' ? 'pulse' : ''}">${
      type === 'driver' ? '🛺' : type === 'from' ? '●' : type === 'to' ? '▲' : '👤'
    }</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -18],
  });

function ClickCatcher({ onMapClick }) {
  useMapEvents({
    click(e) { if (onMapClick) onMapClick(e.latlng.lat, e.latlng.lng); },
  });
  return null;
}

function MapController({ center, focus, markers, route }) {
  const map = useMap();
  const didFit = useRef(false);

  useEffect(() => {
    if (!center || didFit.current) return;
    didFit.current = true;
    map.setView([center.lat, center.lng], center.zoom || 13, { animate: false });
  }, [center, map]);

  useEffect(() => {
    if (focus) {
      map.setView([focus.lat, focus.lng], Math.max(map.getZoom(), 15), { animate: true, duration: 0.5 });
    }
  }, [focus?.lat, focus?.lng, map]);

  useEffect(() => {
    if (!markers.length || didFit.current === false) return;
    // fit all markers when they change substantially
    const pts = markers.map((m) => [m.lat, m.lng]);
    if (route?.coordinates) for (const c of route.coordinates) pts.push([c[1], c[0]]);
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(0.18), { animate: true });
  }, [markers.map((m) => `${m.lat},${m.lng}`).join('|'), route]);

  return null;
}

/**
 * Interactive map.
 * markers: [{lat,lng,type:'driver'|'from'|'to'|'passenger',busy,label}]
 * route: GeoJSON LineString (coords are [lng,lat])
 */
export default function MapView({
  center, markers = [], route, onMapClick, focus, className = '', interactive = true, zoomControl = true,
}) {
  const { dark } = useTheme();
  const tileUrl = dark
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
  const attribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

  const iconCache = useMemo(() => ({}), []);
  const getIcon = (m) => {
    const key = `${m.type}-${m.busy ? 1 : 0}`;
    if (!iconCache[key]) iconCache[key] = makeIcon(m.type, m.busy);
    return iconCache[key];
  };

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <MapContainer
        center={[center?.lat || 12.9716, center?.lng || 77.5946]}
        zoom={center?.zoom || 13}
        className="h-full w-full"
        zoomControl={zoomControl}
        scrollWheelZoom={interactive}
        dragging={interactive}
        doubleClickZoom={interactive}
        touchZoom={interactive}
      >
        <TileLayer url={tileUrl} attribution={attribution} maxZoom={19} />
        <ClickCatcher onMapClick={interactive ? onMapClick : undefined} />
        <MapController center={center} focus={focus} markers={markers} route={route} />
        {route?.coordinates?.length > 1 && (
          <>
            <Polyline positions={route.coordinates.map((c) => [c[1], c[0]])} pathOptions={{ color: '#0d9488', weight: 9, opacity: 0.25 }} />
            <Polyline positions={route.coordinates.map((c) => [c[1], c[0]])} pathOptions={{ color: '#0d9488', weight: 4.5 }} />
          </>
        )}
        {markers.filter(Boolean).map((m, i) => (
          <Marker key={`${m.lat},${m.lng},${i}`} position={[m.lat, m.lng]} icon={getIcon(m)} />
        ))}
      </MapContainer>
    </div>
  );
}
