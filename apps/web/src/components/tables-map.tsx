'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import MapGL, { Marker, NavigationControl, Popup } from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';
import { ApiError, type TableDto } from '@jrst/api-client';
import { useAuth } from '@/components/auth-provider';
import { api } from '@/lib/api';
import { peekCache, putCache, swrGet, tablesCacheKeys } from '@/lib/data-cache';
import { upcomingDiscoverTables } from '@/lib/table-time';
import { formatDateTime, formatPKR } from '@/lib/format';
import { Spinner } from '@/components/spinner';
import { categoryIcon } from '@/lib/category-icon';
import { Input } from '@/components/ui/input';
import { Cover } from '@/components/cover-image';
import {
  ISLAMABAD_CENTER,
  MAP_STYLE_EN,
  PAKISTAN_CENTER,
  PAKISTAN_MAX_BOUNDS,
  isInPakistan,
} from '@/lib/map-style';
import { bindMapEnglishLabels } from '@/lib/map-labels';
import { haversineKm } from '@/lib/geo';
import { GEOLOCATION_OPTIONS, type DeviceLocation } from '@/lib/use-device-location';
import { UserLocationMarker } from '@/components/user-location-marker';

const TIMES = [
  { key: 'morning', label: 'Morning', emoji: '🌅' },
  { key: 'afternoon', label: 'Afternoon', emoji: '☀️' },
  { key: 'evening', label: 'Evening', emoji: '🌙' },
] as const;
type TimeKey = (typeof TIMES)[number]['key'];

/** Local-time bucket for an ISO timestamp. 05–11 morning · 12–16 afternoon · else evening. */
function timeBucket(iso: string): TimeKey {
  const h = new Date(iso).getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  return 'evening';
}

const chipCls = (active: boolean) =>
  `rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
    active ? 'bg-primary text-primary-foreground border-transparent' : 'bg-card hover:bg-muted'
  }`;

interface Pin {
  table: TableDto;
  lat: number;
  lng: number;
  name: string;
}

const POLL_MS = 15_000;
/** Nearby map: only auto-fit meetups within this radius of the user. */
const NEARBY_FOCUS_KM = 30;

type TablesMapProps = {
  mapOnly?: boolean;
  /** Parent-provided meetups (e.g. Nearby page filters). Skips internal fetch when set. */
  tables?: TableDto[] | null;
  loading?: boolean;
  userCoords?: DeviceLocation | null;
};

export default function TablesMap({
  mapOnly = false,
  tables: externalTables,
  loading: externalLoading,
  userCoords = null,
}: TablesMapProps = {}) {
  const useExternal = externalTables !== undefined;
  const { user } = useAuth();
  const browseKey = tablesCacheKeys(user?.id).browse;
  const seedBrowse = peekCache<TableDto[]>(browseKey);

  const [tables, setTables] = useState<TableDto[]>(() => seedBrowse ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !useExternal && seedBrowse == null);
  const mapRef = useRef<MapRef | null>(null);
  const labelCleanupRef = useRef<(() => void) | null>(null);
  const railRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [ready, setReady] = useState(false);
  const [deviceCoords, setDeviceCoords] = useState<DeviceLocation | null>(userCoords);
  const [prevUserCoords, setPrevUserCoords] = useState(userCoords);

  // Parent-provided coords override the local fix when they change.
  if (userCoords !== prevUserCoords) {
    setPrevUserCoords(userCoords);
    if (userCoords) setDeviceCoords(userCoords);
  }

  // filters
  const [showFilters, setShowFilters] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [times, setTimes] = useState<TimeKey[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'few' | 'full'>('all');
  const activeCount = (fromDate ? 1 : 0) + (toDate ? 1 : 0) + times.length;
  const toggleTime = (k: TimeKey) =>
    setTimes((ts) => (ts.includes(k) ? ts.filter((x) => x !== k) : [...ts, k]));
  const clearFilters = () => {
    setFromDate('');
    setToDate('');
    setTimes([]);
    setStatusFilter('all');
  };

  useEffect(() => {
    if (useExternal) return;
    let active = true;
    const key = tablesCacheKeys(user?.id).browse;
    const load = async (forceNetwork: boolean) => {
      try {
        const next = forceNetwork
          ? await api.browseTables().then((data) => {
              putCache(key, data);
              return data;
            })
          : await swrGet(key, () => api.browseTables());
        if (active) {
          setError(null);
          setTables(next);
        }
      } catch (err) {
        if (active) setError(err instanceof ApiError ? err.message : 'Failed to load meetups');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load(false);
    const timer = setInterval(() => void load(true), POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [user?.id, useExternal]);

  useEffect(
    () => () => {
      labelCleanupRef.current?.();
      labelCleanupRef.current = null;
    },
    [],
  );

  const sourceTables = upcomingDiscoverTables(
    useExternal ? (externalTables ?? []) : tables,
  );
  const showLoading = useExternal ? (externalLoading ?? false) : loading;

  const pins = useMemo(() => {
    const out: Pin[] = [];
    for (const t of sourceTables) {
      const lat = t.lat ?? t.cafe?.lat ?? null;
      const lng = t.lng ?? t.cafe?.lng ?? null;
      if (lat == null || lng == null) continue;
      out.push({ table: t, lat, lng, name: t.venueName ?? t.cafe?.name ?? t.category });
    }
    return out;
  }, [sourceTables]);

  const visible = useMemo(() => {
    if (useExternal) return pins;
    return pins.filter((p) => {
      const d = new Date(p.table.startAt);
      if (fromDate && d < new Date(`${fromDate}T00:00:00`)) return false;
      if (toDate && d > new Date(`${toDate}T23:59:59`)) return false;
      if (times.length && !times.includes(timeBucket(p.table.startAt))) return false;
      const seats = p.table.seatsLeft;
      if (statusFilter === 'available' && seats <= 2) return false;
      if (statusFilter === 'few' && (seats <= 0 || seats > 2)) return false;
      if (statusFilter === 'full' && seats > 0) return false;
      return true;
    });
  }, [pins, useExternal, fromDate, toDate, times, statusFilter]);

  useEffect(() => {
    const m = mapRef.current?.getMap();
    if (!m || !ready) return;

    if (mapOnly) {
      if (!deviceCoords) return;

      const localPins = visible.filter(
        (p) =>
          haversineKm(deviceCoords.lat, deviceCoords.lng, p.lat, p.lng) <=
          NEARBY_FOCUS_KM,
      );

      if (localPins.length === 0) {
        m.flyTo({
          center: [deviceCoords.lng, deviceCoords.lat],
          zoom: 14,
          duration: 600,
        });
        return;
      }

      let minLng = deviceCoords.lng;
      let maxLng = deviceCoords.lng;
      let minLat = deviceCoords.lat;
      let maxLat = deviceCoords.lat;
      for (const p of localPins) {
        minLng = Math.min(minLng, p.lng);
        maxLng = Math.max(maxLng, p.lng);
        minLat = Math.min(minLat, p.lat);
        maxLat = Math.max(maxLat, p.lat);
      }
      m.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        { padding: 80, maxZoom: 15, duration: 600 },
      );
      return;
    }

    const includeUser =
      deviceCoords && isInPakistan(deviceCoords.lat, deviceCoords.lng)
        ? deviceCoords
        : null;

    if (visible.length === 0) {
      if (includeUser) {
        m.flyTo({
          center: [includeUser.lng, includeUser.lat],
          zoom: 11,
          duration: 600,
        });
      }
      return;
    }

    if (visible.length === 1 && !includeUser) {
      m.flyTo({ center: [visible[0]!.lng, visible[0]!.lat], zoom: 13, duration: 600 });
      return;
    }

    let minLng = Infinity,
      minLat = Infinity,
      maxLng = -Infinity,
      maxLat = -Infinity;
    for (const p of visible) {
      minLng = Math.min(minLng, p.lng);
      maxLng = Math.max(maxLng, p.lng);
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
    }
    if (includeUser) {
      minLng = Math.min(minLng, includeUser.lng);
      maxLng = Math.max(maxLng, includeUser.lng);
      minLat = Math.min(minLat, includeUser.lat);
      maxLat = Math.max(maxLat, includeUser.lat);
    }
    m.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: 70, maxZoom: 14, duration: 600 },
    );
  }, [visible, ready, deviceCoords, mapOnly]);

  // Drop a selection that filtered out of view.
  if (ready && selectedId && !visible.some((p) => p.table.id === selectedId)) {
    setSelectedId(null);
  }

  const select = useCallback((p: Pin, scrollRail = false) => {
    setSelectedId(p.table.id);
    mapRef.current?.getMap()?.easeTo({ center: [p.lng, p.lat], duration: 400 });
    if (scrollRail)
      railRefs.current[p.table.id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);

  const locate = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const next: DeviceLocation = {
          lat: latitude,
          lng: longitude,
          accuracyM: accuracy,
        };
        setDeviceCoords(next);
        const map = mapRef.current?.getMap();
        if (!map) return;
        if (!isInPakistan(latitude, longitude)) {
          map.flyTo({
            center: [ISLAMABAD_CENTER.lng, ISLAMABAD_CENTER.lat],
            zoom: 11,
            duration: 700,
          });
          return;
        }
        map.flyTo({
          center: [longitude, latitude],
          zoom: 14,
          duration: 700,
        });
      },
      () => undefined,
      GEOLOCATION_OPTIONS,
    );
  }, []);

  const selected = visible.find((p) => p.table.id === selectedId) ?? null;
  const totalSeatsOpen = visible.reduce((sum, p) => sum + Math.max(0, p.table.seatsLeft), 0);

  return (
    <div className="space-y-3">
      {!mapOnly && (
      <>
      {/* filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowFilters((s) => !s)}
          className="bg-card shadow-soft ring-border/60 hover:bg-muted flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold ring-1 transition-colors"
        >
          <i className="fa-solid fa-sliders" /> Filters
          {activeCount > 0 && (
            <span className="bg-primary text-primary-foreground ml-0.5 grid size-4 place-items-center rounded-full text-[10px]">
              {activeCount}
            </span>
          )}
        </button>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-muted-foreground hover:text-foreground text-xs font-semibold"
          >
            Clear
          </button>
        )}
        <span className="text-muted-foreground ml-auto text-sm font-medium">
          {showLoading ? 'Finding meetups…' : `${visible.length} of ${pins.length} meetups`}
        </span>
      </div>

      {showFilters && (
        <div className="bg-card shadow-soft ring-border/60 space-y-3 rounded-2xl p-4 ring-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-muted-foreground text-xs font-semibold">From date</span>
              <Input
                type="date"
                value={fromDate}
                max={toDate || undefined}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground text-xs font-semibold">To date</span>
              <Input
                type="date"
                value={toDate}
                min={fromDate || undefined}
                onChange={(e) => setToDate(e.target.value)}
              />
            </label>
          </div>
          <div className="space-y-1.5">
            <span className="text-muted-foreground text-xs font-semibold">Time of day</span>
            <div className="flex flex-wrap gap-2">
              {TIMES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => toggleTime(t.key)}
                  className={chipCls(times.includes(t.key))}
                >
                  {t.emoji} {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      </>
      )}

      <div className={`flex flex-col gap-4 ${mapOnly ? '' : 'md:h-[74vh] md:flex-row'}`}>
      {/* desktop list rail */}
      {!mapOnly && (
      <aside className="scrollbar-hidden hidden md:flex md:w-80 md:shrink-0 md:flex-col md:gap-2 md:overflow-y-auto md:pr-1">
        {/* header row */}
        <div className="flex items-center justify-between px-1 pb-1">
          <span className="eyebrow text-primary">
            {showLoading ? 'Finding meetups…' : `${visible.length} nearby`}
          </span>
          <button
            type="button"
            onClick={() => setShowFilters((s) => !s)}
            className="text-primary text-xs font-semibold hover:underline"
          >
            Filters {activeCount > 0 ? `(${activeCount})` : '→'}
          </button>
        </div>

        {/* summary line */}
        {!showLoading && visible.length > 0 && (
          <p className="text-muted-foreground px-1 text-xs">
            {visible.length} table{visible.length === 1 ? '' : 's'} · {totalSeatsOpen} seat{totalSeatsOpen === 1 ? '' : 's'} open
          </p>
        )}

        {/* status filter pills */}
        <div className="flex flex-wrap gap-1.5 px-1 pb-1">
          {(
            [
              { key: 'all', label: 'All' },
              { key: 'available', label: 'Available' },
              { key: 'few', label: 'Few left' },
              { key: 'full', label: 'Full' },
            ] as const
          ).map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setStatusFilter(s.key)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                statusFilter === s.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card ring-border/60 hover:bg-muted ring-1'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* list body */}
        {showLoading ? (
          <div className="grid flex-1 place-items-center">
            <Spinner className="text-primary size-6" />
          </div>
        ) : visible.length === 0 ? (
          <p className="text-muted-foreground px-1 text-sm">
            {activeCount > 0 || statusFilter !== 'all'
              ? 'No meetups match these filters.'
              : 'No open meetups nearby right now.'}
          </p>
        ) : (
          <div className="space-y-2">
            {visible.map((p) => {
              const t = p.table;
              const active = selectedId === t.id;
              return (
                <button
                  key={t.id}
                  ref={(el) => {
                    railRefs.current[t.id] = el;
                  }}
                  type="button"
                  onClick={() => select(p)}
                  className={`w-full rounded-2xl bg-card p-3 text-left ring-1 transition-all hover:-translate-y-0.5 ${
                    active ? 'ring-primary shadow-glow' : 'ring-border/60 shadow-soft'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* thumbnail */}
                    <Cover
                      category={t.category}
                      className="h-16 w-20 shrink-0 rounded-xl object-cover"
                    />
                    {/* text block */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-1">
                        <p className="font-heading text-sm font-bold leading-tight tracking-tight">
                          <i className={`fa-solid ${categoryIcon(t.category)}`} /> {t.title ?? t.category}
                        </p>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                            t.pricePKR == null
                              ? 'bg-secondary text-secondary-foreground'
                              : 'bg-primary text-primary-foreground'
                          }`}
                        >
                          {t.pricePKR == null ? 'Free' : formatPKR(t.pricePKR)}
                        </span>
                      </div>
                      <p className="text-muted-foreground mt-0.5 truncate text-xs">📍 {p.name}</p>
                      <p className="text-muted-foreground truncate text-xs">🗓️ {formatDateTime(t.startAt)}</p>
                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-muted-foreground text-xs">🪑 {t.seatsLeft} left</span>
                        <Link
                          href={`/tables/${t.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-primary text-xs font-semibold hover:underline"
                        >
                          View →
                        </Link>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </aside>
      )}

      {/* map */}
      <div className={`relative overflow-hidden rounded-3xl border shadow-soft ${mapOnly ? 'h-[320px] w-full' : 'h-[68vh] flex-1 md:h-full'}`}>
        {showLoading && (
          <div className="bg-background/60 absolute inset-0 z-10 grid place-items-center backdrop-blur-sm">
            <Spinner className="text-primary size-8" />
          </div>
        )}
        <MapGL
          ref={mapRef}
          onLoad={(evt) => {
            setReady(true);
            labelCleanupRef.current?.();
            labelCleanupRef.current = bindMapEnglishLabels(evt.target);
          }}
          initialViewState={{
            longitude: PAKISTAN_CENTER.lng,
            latitude: PAKISTAN_CENTER.lat,
            zoom: 5.5,
          }}
          maxBounds={PAKISTAN_MAX_BOUNDS}
          minZoom={5}
          mapStyle={MAP_STYLE_EN}
          style={{ width: '100%', height: '100%' }}
        >
          <NavigationControl position="top-right" showCompass={false} />
          {visible.map((p) => {
            const active = selectedId === p.table.id;
            return (
              <Marker
                key={p.table.id}
                longitude={p.lng}
                latitude={p.lat}
                onClick={() => select(p, true)}
              >
                <button
                  type="button"
                  className={`flex h-9 items-center gap-1 rounded-full border-2 border-white px-2.5 text-xs font-bold shadow-md transition-transform ${
                    active
                      ? 'bg-ink z-10 scale-[1.15] text-white ring-2 ring-primary'
                      : 'bg-primary text-primary-foreground hover:scale-110'
                  }`}
                  title={p.name}
                >
                  <i className={`fa-solid ${categoryIcon(p.table.category)} text-sm`} />
                  <span>{p.table.seatsLeft}</span>
                </button>
              </Marker>
            );
          })}

          {deviceCoords && (
            <UserLocationMarker
              lat={deviceCoords.lat}
              lng={deviceCoords.lng}
              accuracyM={deviceCoords.accuracyM}
            />
          )}

          {selected && (
            <Popup
              longitude={selected.lng}
              latitude={selected.lat}
              anchor="bottom"
              offset={22}
              maxWidth="290px"
              closeOnClick={false}
              onClose={() => setSelectedId(null)}
              className="table-popup"
            >
              <TableCard pin={selected} onClose={() => setSelectedId(null)} />
            </Popup>
          )}
        </MapGL>

        <div className="glass ring-border/60 absolute left-3 top-3 rounded-full px-3 py-1.5 text-xs font-bold ring-1">
          <i className="fa-solid fa-chair mr-1" />{visible.length} meetup{visible.length === 1 ? '' : 's'} nearby
        </div>
        <button
          type="button"
          onClick={locate}
          className="glass ring-border/60 absolute right-3 bottom-3 grid size-10 place-items-center rounded-full text-lg shadow-md ring-1 transition-transform hover:scale-105"
          title="Center on my location"
        >
          <i className="fa-solid fa-location-crosshairs" />
        </button>
        {error && <p className="text-destructive absolute left-3 top-14 text-sm">{error}</p>}
      </div>
      </div>
    </div>
  );
}

function TableCard({ pin, onClose }: { pin: Pin; onClose: () => void }) {
  const t = pin.table;
  return (
    <div className="bg-card w-64 rounded-2xl p-3.5 shadow-glow">
      <div className="flex items-start justify-between gap-2">
        <p className="font-heading text-sm font-bold tracking-tight">
          <i className={`fa-solid ${categoryIcon(t.category)}`} /> {t.title ?? t.category}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground -mt-0.5 shrink-0 text-sm"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <p className="text-muted-foreground mt-1 text-xs">📍 {pin.name}</p>
      <p className="text-muted-foreground text-xs">🗓️ {formatDateTime(t.startAt)}</p>
      <div className="mt-2 flex items-center justify-between">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            t.pricePKR == null
              ? 'bg-secondary text-secondary-foreground'
              : 'bg-primary text-primary-foreground'
          }`}
        >
          {t.pricePKR == null ? 'Free' : formatPKR(t.pricePKR)}
        </span>
        <span className="text-muted-foreground text-xs font-medium">🪑 {t.seatsLeft} left</span>
      </div>
      <Link
        href={`/tables/${t.id}`}
        className="bg-primary text-primary-foreground mt-3 block rounded-full py-2 text-center text-xs font-semibold transition-[filter] hover:brightness-110"
      >
        View &amp; request →
      </Link>
    </div>
  );
}
