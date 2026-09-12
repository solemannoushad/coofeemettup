'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { type NotificationDto, type TableDto } from '@jrst/api-client';
import { useAuth } from '@/components/auth-provider';
import { api } from '@/lib/api';
import { peekCache, swrGet, tablesCacheKeys } from '@/lib/data-cache';
import { formatDateTime, formatPKR } from '@/lib/format';
import { Cover } from '@/components/cover-image';
import { categoryIcon, splitCategories } from '@/lib/category-icon';
import { CategoryPills } from '@/components/category-pills';
import { haversineKm, formatDistance } from '@/lib/geo';
import { tableCta } from '@/lib/table-cta';
import { upcomingDiscoverTables } from '@/lib/table-time';
import { useDeviceLocation } from '@/lib/use-device-location';

// Map libraries touch window/document — load client-only.
const TablesMap = dynamic(() => import('@/components/tables-map'), { ssr: false });

/* ─── helpers ──────────────────────────────────────────────────────── */

type TableStatus = 'available' | 'few' | 'full';

function tableStatus(t: TableDto): TableStatus {
  if (t.seatsLeft <= 0) return 'full';
  if (t.seatsLeft <= 2) return 'few';
  return 'available';
}

function tableDist(
  t: TableDto,
  coords: { lat: number; lng: number } | null,
): number | null {
  if (!coords) return null;
  const tLat = t.lat ?? t.cafe?.lat ?? null;
  const tLng = t.lng ?? t.cafe?.lng ?? null;
  if (tLat == null || tLng == null) return null;
  return haversineKm(coords.lat, coords.lng, tLat, tLng);
}

/** Relative-time helper — e.g. "2 min ago", "1 hr ago". */
function ago(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  return `${Math.round(diffHr / 24)} d ago`;
}

const RADIUS_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: 'Any', value: null },
  { label: '0.5 km', value: 0.5 },
  { label: '1 km', value: 1 },
  { label: '3 km', value: 3 },
  { label: '5 km', value: 5 },
  { label: '10 km', value: 10 },
];

const STATUS_OPTS = [
  { key: 'all' as const, label: 'All' },
  { key: 'available' as const, label: 'Available', color: 'text-emerald-500' },
  { key: 'few' as const, label: 'Few seats left', color: 'text-amber-500' },
  { key: 'full' as const, label: 'Full', color: 'text-rose-500' },
];

const PAGE_SIZE = 6;

/* ─── skeleton card ────────────────────────────────────────────────── */

function SkeletonCard() {
  return (
    <div className="bg-card flex gap-4 rounded-2xl border p-3">
      {/* thumbnail placeholder */}
      <div className="size-16 shrink-0 rounded-xl bg-muted animate-pulse" />

      {/* middle placeholder */}
      <div className="min-w-0 flex-1 space-y-2 py-0.5">
        {/* status badge */}
        <div className="h-4 w-20 rounded-full bg-muted animate-pulse" />
        {/* title */}
        <div className="h-4 w-3/4 rounded bg-muted animate-pulse" />
        {/* venue */}
        <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
        {/* category chip */}
        <div className="h-4 w-16 rounded-full bg-muted animate-pulse" />
        {/* meta row */}
        <div className="flex gap-3">
          <div className="h-3 w-12 rounded bg-muted animate-pulse" />
          <div className="h-3 w-16 rounded bg-muted animate-pulse" />
          <div className="h-3 w-20 rounded bg-muted animate-pulse" />
        </div>
      </div>

      {/* right placeholder */}
      <div className="flex shrink-0 flex-col items-end justify-between py-0.5">
        <div className="h-5 w-12 rounded bg-muted animate-pulse" />
        <div className="h-9 w-24 rounded-full bg-muted animate-pulse" />
      </div>
    </div>
  );
}

/* ─── status badge ─────────────────────────────────────────────────── */

function StatusBadge({ status }: { status: TableStatus }) {
  if (status === 'available')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
        <span className="inline-block size-1.5 rounded-full bg-emerald-500" />
        Available
      </span>
    );
  if (status === 'few')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-600">
        <span className="inline-block size-1.5 rounded-full bg-amber-500" />
        Few seats left
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-600">
      <span className="inline-block size-1.5 rounded-full bg-rose-500" />
      Full
    </span>
  );
}

/* ─── table row card ───────────────────────────────────────────────── */

function TableRow({
  t,
  coords,
  viewerId,
}: {
  t: TableDto;
  coords: { lat: number; lng: number } | null;
  viewerId?: string | null;
}) {
  const status = tableStatus(t);
  const dist = tableDist(t, coords);
  const cta = tableCta(t, viewerId);
  const venue = t.venueName ?? t.cafe?.name ?? 'See map';

  return (
    <Link
      href={`/tables/${t.id}`}
      className="bg-card flex flex-col gap-3 rounded-2xl border p-3 transition-shadow hover:shadow-glow sm:flex-row sm:gap-4"
    >
      <div className="flex min-w-0 flex-1 gap-3 sm:gap-4">
        {/* thumbnail */}
        <div className="size-16 shrink-0 overflow-hidden rounded-xl">
          <Cover
            src={t.imageUrl ?? undefined}
            category={t.category}
            className="h-full w-full object-cover"
          />
        </div>

        {/* middle */}
        <div className="min-w-0 flex-1">
          <StatusBadge status={status} />
          <p className="mt-0.5 truncate font-bold leading-snug">{t.title ?? t.category}</p>
          <p className="text-muted-foreground flex items-center gap-1 truncate text-xs">
            <i className="fa-solid fa-location-dot" /> {venue}
          </p>
          <CategoryPills category={t.category} variant="chip" max={3} className="mt-1" />
          {/* meta row */}
          <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
            {dist != null && (
              <span>
                <i className="fa-solid fa-route mr-0.5" />
                {formatDistance(dist)}
              </span>
            )}
            <span>
              <i className="fa-solid fa-chair mr-0.5" />
              {t.seats - t.seatsLeft}/{t.seats} seats
            </span>
            <span>
              <i className="fa-solid fa-calendar-day mr-0.5" />
              {formatDateTime(t.startAt)}
            </span>
          </div>
        </div>
      </div>

      {/* right */}
      <div className="flex shrink-0 flex-row items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-between">
        <span className="font-extrabold text-primary">
          {t.pricePKR == null ? 'Free' : formatPKR(t.pricePKR)}
        </span>
        <span
          className={`rounded-full px-4 py-2 text-sm font-semibold ${
            cta.primary
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-primary'
          }`}
        >
          {cta.label}
        </span>
      </div>
    </Link>
  );
}

/* ─── page ──────────────────────────────────────────────────────────── */

export default function NearbyTablesPage() {
  const { user } = useAuth(); // ensure auth context is loaded

  const seedKeys = tablesCacheKeys(user?.id);
  const seedBrowse = peekCache<TableDto[]>(seedKeys.browse);

  const [tables, setTables] = useState<TableDto[] | null>(null);
  const [notifications, setNotifications] = useState<NotificationDto[]>([]);
  const [loadingTables, setLoadingTables] = useState(() => seedBrowse == null);
  const {
    location,
    error: locationError,
    pending: locationPending,
    refresh: refreshLocation,
  } = useDeviceLocation();
  const coords = location
    ? { lat: location.lat, lng: location.lng }
    : null;

  // filters
  const [radiusKm, setRadiusKm] = useState<number | null>(null); // null = Any
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState<'all' | 'available' | 'few' | 'full'>('all');
  const [visible, setVisible] = useState(PAGE_SIZE);

  const rawBrowse = tables ?? seedBrowse ?? null;
  const tablesView = rawBrowse == null ? null : upcomingDiscoverTables(rawBrowse);
  const listsPending = loadingTables && tablesView == null;

  /* data fetch */
  useEffect(() => {
    let active = true;
    const keys = tablesCacheKeys(user?.id);
    void (async () => {
      try {
        const list = await swrGet(keys.browse, () => api.browseTables());
        if (active) {
          setTables(list);
          setLoadingTables(false);
        }
        const notif = await api
          .notifications()
          .catch(() => ({ items: [] as NotificationDto[], unread: 0 }));
        if (active) setNotifications(notif.items);
      } finally {
        if (active) setLoadingTables(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [user?.id]);

  /* derived categories */
  const categories = useMemo(
    () =>
      [...new Set((tablesView ?? []).flatMap((t) => splitCategories(t.category)))].sort(),
    [tablesView],
  );

  /* filtered + sorted list */
  const filtered = useMemo(() => {
    const list = (tablesView ?? []).filter((t) => {
      // category filter
      if (category && !splitCategories(t.category).includes(category)) return false;
      // status filter
      const s = tableStatus(t);
      if (status !== 'all' && s !== status) return false;
      // radius filter (only when coords exist and a radius is chosen)
      if (radiusKm != null && coords) {
        const dist = tableDist(t, coords);
        if (dist != null && dist > radiusKm) return false;
        // if table has no coords, pass it through (don't silently hide)
      }
      return true;
    });

    // sort: nearest-first when coords available, else soonest startAt
    if (coords) {
      return list.slice().sort((a, b) => {
        const da = tableDist(a, coords) ?? Infinity;
        const db = tableDist(b, coords) ?? Infinity;
        return da - db;
      });
    }
    return list.slice().sort(
      (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
    );
  }, [tablesView, category, status, radiusKm, coords]);

  /* summary stats */
  const stats = useMemo(() => {
    const all = tablesView ?? [];
    const seatsLeft = all.reduce((s, t) => s + Math.max(0, t.seatsLeft), 0);
    const venues = new Set(all.map((t) => t.venueName ?? t.cafe?.name).filter(Boolean)).size;
    const freeTables = all.filter((t) => t.pricePKR == null).length;
    return { total: all.length, seatsLeft, venues, freeTables };
  }, [tablesView]);

  const resetFilters = () => {
    setRadiusKm(null);
    setCategory('');
    setStatus('all');
    setVisible(PAGE_SIZE);
  };

  return (
    <main className="mx-auto w-full max-w-[1508px] flex-1 px-4 py-8 sm:px-6 lg:px-12">
      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)_300px]">
        {/* ── LEFT: filters ───────────────────────────────────────────── */}
        <aside className="bg-card order-2 rounded-3xl border p-5 shadow-soft lg:order-1 lg:sticky lg:top-24 lg:self-start">
          <h2 className="font-bold tracking-tight">Find meetups nearby</h2>
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
            Discover conversations happening around you.
          </p>

          <div className="mt-5 space-y-5">
            {/* LOCATION */}
            <div>
              <p className="text-muted-foreground mb-1 text-[10px] font-semibold uppercase tracking-widest">
                Location
              </p>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">
                  {locationPending
                    ? 'Locating…'
                    : location
                      ? `Near you (±${Math.round(location.accuracyM)} m)`
                      : locationError === 'denied'
                        ? 'Location blocked'
                        : 'Location off'}
                </span>
                <button
                  type="button"
                  onClick={refreshLocation}
                  className="text-primary text-xs font-semibold hover:underline"
                >
                  Refresh
                </button>
              </div>
              {location && location.accuracyM > 150 && (
                <p className="text-muted-foreground mt-1 text-[10px] leading-relaxed">
                  Signal is coarse — try refreshing outdoors or enable precise location in your browser.
                </p>
              )}
            </div>

            {/* RADIUS */}
            <div>
              <p className="text-muted-foreground mb-2 text-[10px] font-semibold uppercase tracking-widest">
                Radius
              </p>
              <div className="flex flex-wrap gap-1.5">
                {RADIUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => { setRadiusKm(opt.value); setVisible(PAGE_SIZE); }}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                      radiusKm === opt.value
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-foreground hover:bg-muted'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {!coords && radiusKm != null && (
                <p className="text-muted-foreground mt-1.5 text-[10px]">
                  Enable location to filter by distance
                </p>
              )}
            </div>

            {/* VIBES / TOPICS */}
            <div>
              <p className="text-muted-foreground mb-2 text-[10px] font-semibold uppercase tracking-widest">
                Vibes / Topics
              </p>
              <ul className="space-y-0.5">
                <li>
                  <button
                    type="button"
                    onClick={() => { setCategory(''); setVisible(PAGE_SIZE); }}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
                      category === ''
                        ? 'bg-secondary text-primary'
                        : 'text-foreground hover:bg-muted'
                    }`}
                  >
                    <i className="fa-solid fa-grip w-4 text-center" />
                    All Vibes
                  </button>
                </li>
                {categories.map((c) => (
                  <li key={c}>
                    <button
                      type="button"
                      onClick={() => { setCategory(category === c ? '' : c); setVisible(PAGE_SIZE); }}
                      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
                        category === c
                          ? 'bg-secondary text-primary'
                          : 'text-foreground hover:bg-muted'
                      }`}
                    >
                      <i className={`fa-solid ${categoryIcon(c)} w-4 text-center`} />
                      {c}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {/* clear all */}
            <button
              type="button"
              onClick={resetFilters}
              className="text-muted-foreground w-full text-center text-xs font-semibold hover:text-foreground hover:underline"
            >
              Clear all filters
            </button>
          </div>
        </aside>

        {/* ── CENTER: map + list ──────────────────────────────────────── */}
        <div className="order-1 min-w-0 space-y-4 lg:order-2">
          {/* map */}
          <TablesMap
            mapOnly
            tables={filtered}
            loading={listsPending}
            userCoords={location}
          />

          {/* status filter row */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {STATUS_OPTS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => { setStatus(opt.key); setVisible(PAGE_SIZE); }}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                    status === opt.key
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card border hover:bg-muted'
                  }`}
                >
                  {opt.color && (
                    <span
                      className={`inline-block size-2 rounded-full ${
                        opt.key === 'available'
                          ? 'bg-emerald-500'
                          : opt.key === 'few'
                          ? 'bg-amber-500'
                          : 'bg-rose-500'
                      }`}
                    />
                  )}
                  {opt.label}
                </button>
              ))}
            </div>
            <span className="text-muted-foreground text-xs font-semibold">
              Sort by: {coords ? 'Nearest' : 'Soonest'}
            </span>
          </div>

          {/* table list */}
          {listsPending && (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          )}

          {!listsPending && filtered.length === 0 && (
            <div className="rounded-3xl border border-dashed py-16 text-center">
              <i className="fa-solid fa-location-dot text-muted-foreground text-3xl" />
              <p className="text-muted-foreground mt-3 text-sm">
                No tables match — try a wider radius or clearing filters.
              </p>
              <button
                type="button"
                onClick={resetFilters}
                className="text-primary mt-3 text-sm font-semibold hover:underline"
              >
                Clear filters
              </button>
            </div>
          )}

          {!listsPending && filtered.length > 0 && (
            <>
              <div className="space-y-3">
                {filtered.slice(0, visible).map((t) => (
                  <TableRow key={t.id} t={t} coords={coords} viewerId={user?.id} />
                ))}
              </div>
              {visible < filtered.length && (
                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    onClick={() => setVisible((v) => v + PAGE_SIZE)}
                    className="bg-card border-border rounded-full border px-6 py-2.5 text-sm font-semibold shadow-soft transition-shadow hover:shadow-glow"
                  >
                    Load more meetups
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── RIGHT: sidebar ──────────────────────────────────────────── */}
        <aside className="order-3 max-lg:hidden space-y-4 lg:sticky lg:top-24 lg:self-start">
          {/* nearby summary */}
          <div className="bg-card rounded-3xl border p-5 shadow-soft">
            <p className="mb-4 font-bold tracking-tight">Nearby summary</p>
            <div className="space-y-3">
              {[
                { value: stats.total, label: 'Active meetups', sub: 'around you' },
                { value: stats.seatsLeft, label: 'Available seats', sub: 'right now' },
                { value: stats.venues, label: 'Cafes hosting', sub: 'conversations' },
                { value: stats.freeTables, label: 'Free meetups', sub: 'no cover' },
              ].map((row) => (
                <div key={row.label} className="flex items-center gap-3">
                  <span className="text-primary text-xl font-extrabold leading-none w-10 shrink-0">
                    {listsPending ? (
                      <span className="block h-5 w-8 rounded bg-muted animate-pulse" />
                    ) : (
                      row.value
                    )}
                  </span>
                  <div>
                    <p className="text-sm font-semibold leading-tight">{row.label}</p>
                    <p className="text-muted-foreground text-xs">{row.sub}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* live around you */}
          <div className="bg-card rounded-3xl border p-5 shadow-soft">
            <p className="mb-4 font-bold tracking-tight">Live around you</p>
            {notifications.length === 0 ? (
              <p className="text-muted-foreground text-sm">No recent activity nearby.</p>
            ) : (
              <ul className="space-y-3">
                {notifications.slice(0, 4).map((n) => (
                  <li key={n.id} className="flex items-start gap-3">
                    <span className="bg-primary/10 grid size-8 shrink-0 place-items-center rounded-full">
                      <i className="fa-solid fa-bell text-primary text-xs" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold leading-tight">{n.title}</p>
                      <p className="text-muted-foreground text-xs">{ago(n.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* create a table */}
          <div className="bg-secondary rounded-3xl p-5">
            <div className="bg-primary/10 mb-3 grid size-10 place-items-center rounded-2xl">
              <i className="fa-solid fa-mug-hot text-primary" />
            </div>
            <p className="font-bold tracking-tight">Can&apos;t find the right meetup?</p>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              Create your own meetup and invite people to join your conversation.
            </p>
            <Link
              href="/tables/new"
              className="bg-primary text-primary-foreground mt-4 block rounded-full py-2.5 text-center text-sm font-semibold transition-[filter] hover:brightness-110"
            >
              Create a meetup
            </Link>
          </div>
        </aside>
      </div>
    </main>
  );
}
