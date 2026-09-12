'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type TableDto } from '@jrst/api-client';
import { useAuth } from '@/components/auth-provider';
import { api } from '@/lib/api';
import { peekCache, swrGet, tablesCacheKeys } from '@/lib/data-cache';
import { formatDateTime, formatPKR } from '@/lib/format';
import { categoryIcon, splitCategories } from '@/lib/category-icon';
import { haversineKm, formatDistance, googleMapsUrl } from '@/lib/geo';
import { tableCta } from '@/lib/table-cta';
import { upcomingDiscoverTables } from '@/lib/table-time';
import { Cover } from '@/components/cover-image';
import { Avatar } from '@/components/avatar';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ContentPlaceholder } from '@/components/spinner';
import { TableCardGridSkeleton } from '@/components/skeletons/table-card-skeleton';
import { StaggerIn } from '@/components/stagger-in';
import { CategoryPills } from '@/components/category-pills';
import {
  ISLAMABAD_CENTER,
  MAP_STYLE_EN,
  PAKISTAN_MAX_BOUNDS,
} from '@/lib/map-style';
import { bindMapEnglishLabels } from '@/lib/map-labels';
import type { Map as MaplibreMap } from 'maplibre-gl';

/* ─── types ──────────────────────────────────────────────────────────── */

type PriceFilter = 'all' | 'free' | 'paid';
type SortKey = 'relevant' | 'newest' | 'price_asc' | 'seats';
type ViewMode = 'list' | 'grid';

/* ─── constants ──────────────────────────────────────────────────────── */

const CATEGORIES = [
  { label: 'Language Exchange', icon: 'fa-language' },
  { label: 'Deep Talks', icon: 'fa-comments' },
  { label: 'Startup & Business', icon: 'fa-rocket' },
  { label: 'Books & Writing', icon: 'fa-book' },
  { label: 'Mindfulness', icon: 'fa-spa' },
  { label: 'Coffee & Casual', icon: 'fa-mug-hot' },
  { label: 'Networking', icon: 'fa-handshake' },
] as const;

const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: 'relevant', label: 'Most relevant' },
  { id: 'newest', label: 'Newest first' },
  { id: 'price_asc', label: 'Price: Low to high' },
  { id: 'seats', label: 'Most seats' },
];

const DATE_OPTIONS = [
  { id: 'any', label: 'Any date' },
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'weekend', label: 'This weekend' },
  { id: 'month', label: 'This month' },
];

const TIME_OPTIONS = [
  { id: 'any', label: 'Any time' },
  { id: 'morning', label: 'Morning (6–12)' },
  { id: 'afternoon', label: 'Afternoon (12–17)' },
  { id: 'evening', label: 'Evening (17–22)' },
];

const VIBE_OPTIONS = [
  { id: 'any', label: 'All vibes' },
  { id: 'casual', label: 'Casual & chill' },
  { id: 'focused', label: 'Focused' },
  { id: 'social', label: 'Social' },
  { id: 'intellectual', label: 'Intellectual' },
];

/* ─── dynamic imports ────────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MapGL = dynamic(() => import('react-map-gl/maplibre').then((m) => m.default) as any, {
  ssr: false,
}) as React.ComponentType<React.ComponentProps<'div'> & Record<string, unknown>>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Marker = dynamic(() => import('react-map-gl/maplibre').then((m) => m.Marker) as any, {
  ssr: false,
}) as React.ComponentType<Record<string, unknown>>;

/* ─── helpers ────────────────────────────────────────────────────────── */

const NOW = Date.now();

function matchesDate(t: TableDto, date: string): boolean {
  if (date === 'any') return true;
  const start = new Date(t.startAt).getTime();
  if (date === 'today') {
    const s = new Date(NOW).setHours(0, 0, 0, 0);
    return start >= s && start < s + 86400_000;
  }
  if (date === 'week') return start >= NOW && start <= NOW + 7 * 86400_000;
  if (date === 'weekend') {
    if (start < NOW) return false;
    const d = new Date(start).getDay();
    return d === 0 || d === 6;
  }
  if (date === 'month') return start >= NOW && start <= NOW + 30 * 86400_000;
  return true;
}

function matchesTime(t: TableDto, time: string): boolean {
  if (time === 'any') return true;
  const h = new Date(t.startAt).getHours();
  if (time === 'morning') return h >= 6 && h < 12;
  if (time === 'afternoon') return h >= 12 && h < 17;
  if (time === 'evening') return h >= 17 && h < 22;
  return true;
}

function matchesPrice(t: TableDto, price: PriceFilter): boolean {
  if (price === 'all') return true;
  if (price === 'free') return t.pricePKR == null || t.pricePKR === 0;
  if (price === 'paid') return t.pricePKR != null && t.pricePKR > 0;
  return true;
}

function sortResults(items: TableDto[], sort: SortKey): TableDto[] {
  const copy = [...items];
  if (sort === 'newest') copy.sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime());
  else if (sort === 'price_asc') copy.sort((a, b) => (a.pricePKR ?? 0) - (b.pricePKR ?? 0));
  else if (sort === 'seats') copy.sort((a, b) => b.seatsLeft - a.seatsLeft);
  return copy;
}

/* ─── sub-components ─────────────────────────────────────────────────── */

function AvatarStack({ host, going }: { host?: TableDto['host']; going: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {host && <Avatar name={host.username ?? 'member'} size={24} />}
      {going > 0 && (
        <span className="bg-secondary text-secondary-foreground grid size-6 place-items-center rounded-full text-[10px] font-bold ring-2 ring-card">
          +{going}
        </span>
      )}
    </div>
  );
}

function TableListRow({ t }: { t: TableDto }) {
  const going = t.seats - t.seatsLeft;
  const low = t.seatsLeft > 0 && t.seatsLeft <= 2;
  return (
    <Link
      href={`/tables/${t.id}`}
      className="bg-card shadow-soft ring-border/60 group flex gap-4 overflow-hidden rounded-3xl border p-3 ring-1 transition-all hover:-translate-y-0.5 hover:shadow-glow"
    >
      {/* thumbnail */}
      <div className="relative h-20 w-24 shrink-0 overflow-hidden rounded-2xl sm:h-28 sm:w-40">
        <Cover
          src={t.imageUrl ?? undefined}
          category={t.category}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
      </div>

      {/* content */}
      <div className="flex min-w-0 flex-1 flex-col justify-between py-1">
        <div>
          <CategoryPills category={t.category} variant="badge" max={3} className="mb-1.5" />
          <h3 className="font-heading line-clamp-1 text-base font-bold tracking-tight">
            {t.title ?? t.category}
          </h3>
          <p className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
            <i className="fa-solid fa-location-dot" />
            {t.venueName ?? t.cafe?.name ?? 'See map'}
          </p>
          <p className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
            <i className="fa-regular fa-calendar" />
            {formatDateTime(t.startAt)}
          </p>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <AvatarStack host={t.host} going={going} />
          {going > 0 && (
            <span className="text-primary text-xs font-semibold">{going} going</span>
          )}
          {t.seatsLeft > 0 ? (
            <Badge variant={low ? 'warning' : 'outline'} className="ml-auto">
              {t.seatsLeft} seats left
            </Badge>
          ) : (
            <Badge variant="destructive" className="ml-auto">Full</Badge>
          )}
          <span className="font-heading text-primary font-extrabold">
            {t.pricePKR == null ? 'Free' : formatPKR(t.pricePKR)}
          </span>
        </div>
      </div>

      {/* save */}
    </Link>
  );
}

function TableCoverCard({
  t,
  coords,
  viewerId,
}: {
  t: TableDto;
  coords: { lat: number; lng: number } | null;
  viewerId?: string | null;
}) {
  const going = t.seats - t.seatsLeft;
  const low = t.seatsLeft > 0 && t.seatsLeft <= 2;
  const cta = tableCta(t, viewerId);
  const tLat = t.lat ?? t.cafe?.lat ?? null;
  const tLng = t.lng ?? t.cafe?.lng ?? null;
  const distance =
    coords && tLat != null && tLng != null
      ? formatDistance(haversineKm(coords.lat, coords.lng, tLat, tLng))
      : null;
  return (
    <Link
      href={`/tables/${t.id}`}
      className="bg-card shadow-soft ring-border/60 group block overflow-hidden rounded-3xl ring-1 transition-all hover:-translate-y-0.5 hover:shadow-glow"
    >
      <div className="relative h-40">
        <Cover
          src={t.imageUrl ?? undefined}
          category={t.category}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
        <CategoryPills
          category={t.category}
          variant="glass"
          max={3}
          className="absolute left-3 top-3 max-w-[calc(100%-1.5rem)]"
        />
      </div>
      <div className="p-4">
        <h3 className="font-heading line-clamp-1 text-base font-bold tracking-tight">
          {t.title ?? t.category}
        </h3>
        <p className="text-muted-foreground mt-1 flex items-center gap-1 text-sm">
          <i className="fa-solid fa-location-dot" />
          {t.venueName ?? t.cafe?.name ?? 'See map'}
          {distance && <span className="text-muted-foreground"> · {distance}</span>}
          {tLat != null && tLng != null && (
            <button
              type="button"
              aria-label="Open location in Google Maps"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                window.open(googleMapsUrl(tLat as number, tLng as number), '_blank', 'noopener');
              }}
              className="text-primary hover:text-primary/80 ml-1"
            >
              <i className="fa-solid fa-map-pin" />
            </button>
          )}
        </p>
        <p className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
          <i className="fa-solid fa-calendar-day" />{formatDateTime(t.startAt)}
        </p>
        <div className="text-muted-foreground mt-2 flex items-center gap-1.5 text-xs">
          <Avatar name={t.host?.username ?? 'member'} size={22} />
          Hosted by @{t.host?.username ?? 'member'}
          {going > 0 && <span className="text-primary ml-1 font-semibold">{going} going</span>}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <Badge variant={low ? 'warning' : 'secondary'}>
            {t.seatsLeft > 0 ? `${t.seatsLeft} seats left` : 'Full'}
          </Badge>
          <span className="font-heading text-primary font-extrabold">
            {t.pricePKR == null ? 'Free' : formatPKR(t.pricePKR)}
          </span>
        </div>
        <div
          className={`mt-3 rounded-full py-2 text-center text-sm font-semibold transition-[filter] group-hover:brightness-110 ${
            cta.primary ? 'bg-primary text-primary-foreground' : 'bg-secondary text-primary'
          }`}
        >
          {cta.label}
        </div>
      </div>
    </Link>
  );
}

/* ─── right rail: map preview ────────────────────────────────────────── */

function MapPreview({ results }: { results: TableDto[] }) {
  const [mapReady, setMapReady] = useState(false);
  const labelCleanupRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      labelCleanupRef.current?.();
      labelCleanupRef.current = null;
    },
    [],
  );

  const pins = useMemo(() => {
    return results.flatMap((t) => {
      const lat = t.lat ?? t.cafe?.lat ?? null;
      const lng = t.lng ?? t.cafe?.lng ?? null;
      if (lat == null || lng == null) return [];
      return [{ id: t.id, lat, lng, seatsLeft: t.seatsLeft, category: t.category }];
    });
  }, [results]);

  const pinColor = (seats: number) =>
    seats <= 0
      ? 'bg-destructive text-white'
      : seats <= 2
        ? 'bg-accent-amber text-white'
        : 'bg-primary text-primary-foreground';

  return (
    <div className="bg-card shadow-soft overflow-hidden rounded-3xl border">
      <div className="flex items-center justify-between p-4 pb-2">
        <p className="font-heading font-bold tracking-tight">
          <i className="fa-solid fa-map-location-dot text-primary mr-1.5" />
          Explore in map
        </p>
        <Link
          href="/tables/nearby"
          className="text-primary text-xs font-semibold hover:underline"
        >
          View full map →
        </Link>
      </div>

      {/* real map */}
      <div className="relative mx-4 mb-4 overflow-hidden rounded-2xl border" style={{ height: 220 }}>
        {/* maplibre-gl CSS is imported in tables-map.tsx; re-import here if needed */}
        <MapGL
          initialViewState={{
            longitude: ISLAMABAD_CENTER.lng,
            latitude: ISLAMABAD_CENTER.lat,
            zoom: 10,
          }}
          maxBounds={PAKISTAN_MAX_BOUNDS}
          minZoom={5}
          mapStyle={MAP_STYLE_EN}
          style={{ width: '100%', height: '100%' }}
          onLoad={(evt) => {
            setMapReady(true);
            labelCleanupRef.current?.();
            labelCleanupRef.current = bindMapEnglishLabels(
              evt.target as unknown as MaplibreMap,
            );
          }}
        >
          {mapReady &&
            pins.map((p) => (
              <Marker key={p.id} longitude={p.lng} latitude={p.lat}>
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-xs font-bold shadow-md ${pinColor(p.seatsLeft)}`}
                  title={p.category}
                >
                  <i className={`fa-solid ${categoryIcon(p.category)}`} />
                </span>
              </Marker>
            ))}
        </MapGL>

        {/* fallback overlay if no JS / map not ready */}
        {pins.length === 0 && (
          <div className="bg-muted/60 absolute inset-0 flex flex-col items-center justify-center gap-2">
            <i className="fa-solid fa-map text-muted-foreground text-3xl" />
            <p className="text-muted-foreground text-xs">No pinned locations</p>
          </div>
        )}
      </div>

      {/* legend */}
      <div className="border-t px-4 pb-3 pt-2">
        <p className="text-muted-foreground mb-1.5 text-[10px] font-semibold uppercase tracking-widest">
          Legend
        </p>
        <div className="flex flex-wrap gap-3">
          {[
            { color: 'bg-primary', label: 'Many meetups' },
            { color: 'bg-accent-amber', label: 'Some' },
            { color: 'bg-destructive', label: 'Few' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5">
              <span className={`inline-block size-2.5 rounded-full ${color}`} />
              <span className="text-muted-foreground text-xs">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── right rail: you might also like ───────────────────────────────── */

function MightLike({ tables }: { tables: TableDto[] }) {
  const picks = tables.slice(0, 3);
  return (
    <div className="bg-card shadow-soft rounded-3xl border p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-heading font-bold tracking-tight">You might also like</p>
        <Link href="/discover" className="text-primary text-xs font-semibold hover:underline">
          View all
        </Link>
      </div>
      {picks.length === 0 ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : (
        <ul className="space-y-3">
          {picks.map((t) => {
            const going = t.seats - t.seatsLeft;
            return (
              <li key={t.id}>
                <Link
                  href={`/tables/${t.id}`}
                  className="hover:bg-muted -mx-2 flex items-center gap-3 rounded-2xl px-2 py-2 transition-colors"
                >
                  {/* 56px cover thumb */}
                  <Cover
                    src={t.imageUrl ?? undefined}
                    category={t.category}
                    className="size-14 shrink-0 rounded-xl object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-heading line-clamp-1 text-sm font-bold">
                      {t.title ?? t.category}
                    </p>
                    <CategoryPills category={t.category} variant="muted" max={2} />
                    <p className="text-muted-foreground flex items-center gap-1 truncate text-xs">
                      <i className="fa-solid fa-location-dot" />{t.venueName ?? t.cafe?.name ?? 'See map'}
                    </p>
                    <p className="text-muted-foreground flex items-center gap-1 truncate text-xs">
                      <i className="fa-solid fa-calendar-day" />{formatDateTime(t.startAt)}
                    </p>
                    {going > 0 && (
                      <p className="text-primary text-xs font-semibold">{going} going</p>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ─── left rail: filters ─────────────────────────────────────────────── */

interface FiltersProps {
  location: string;
  setLocation: (v: string) => void;
  dateFilter: string;
  setDateFilter: (v: string) => void;
  timeFilter: string;
  setTimeFilter: (v: string) => void;
  selectedCats: string[];
  toggleCat: (c: string) => void;
  groupSize: number;
  setGroupSize: (v: number) => void;
  priceFilter: PriceFilter;
  setPriceFilter: (v: PriceFilter) => void;
  vibeFilter: string;
  setVibeFilter: (v: string) => void;
  onReset: () => void;
  onApply: () => void;
}

function FilterPanel({
  location, setLocation,
  dateFilter, setDateFilter,
  timeFilter, setTimeFilter,
  selectedCats, toggleCat,
  groupSize, setGroupSize,
  priceFilter, setPriceFilter,
  vibeFilter, setVibeFilter,
  onReset,
}: FiltersProps) {
  const selectCls =
    'border-input bg-card/60 focus-visible:border-ring focus-visible:ring-ring/25 w-full rounded-2xl border px-3 py-2 text-sm outline-none focus-visible:ring-4';

  return (
    <aside className="bg-card shadow-soft order-2 rounded-3xl border p-5 lg:order-1 lg:sticky lg:top-24 lg:self-start">
      {/* header */}
      <div className="mb-5 flex items-center justify-between">
        <p className="font-heading font-bold tracking-tight">Filters</p>
        <button
          type="button"
          onClick={onReset}
          className="text-primary text-xs font-semibold hover:underline"
        >
          Reset
        </button>
      </div>

      {/* location */}
      <div className="mb-4">
        <p className="text-muted-foreground mb-1.5 text-xs font-semibold uppercase tracking-widest">
          Search within
        </p>
        <div className="relative">
          <Input
            placeholder="Islamabad, Pakistan"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="pr-10"
          />
          <button
            type="button"
            className="text-primary absolute right-3 top-1/2 -translate-y-1/2 text-sm"
            aria-label="Use my location"
          >
            <i className="fa-solid fa-location-crosshairs" />
          </button>
        </div>
      </div>

      {/* date */}
      <div className="mb-4">
        <p className="text-muted-foreground mb-1.5 text-xs font-semibold uppercase tracking-widest">
          Date
        </p>
        <select
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className={selectCls}
        >
          {DATE_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* time */}
      <div className="mb-4">
        <p className="text-muted-foreground mb-1.5 text-xs font-semibold uppercase tracking-widest">
          Time
        </p>
        <select
          value={timeFilter}
          onChange={(e) => setTimeFilter(e.target.value)}
          className={selectCls}
        >
          {TIME_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* category checkboxes */}
      <div className="mb-4">
        <p className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-widest">
          Category
        </p>
        <ul className="space-y-1">
          {CATEGORIES.map(({ label, icon }) => {
            const checked = selectedCats.includes(label);
            return (
              <li key={label}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleCat(label)}
                    className="accent-primary size-4 shrink-0 rounded"
                  />
                  <i className={`fa-solid ${icon} text-primary w-4 text-center text-xs`} />
                  <span className="text-sm">{label}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      {/* group size */}
      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-muted-foreground text-xs font-semibold uppercase tracking-widest">
            Group size
          </p>
          <span className="text-xs font-semibold">
            {groupSize === 20 ? '20+' : groupSize}
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={20}
          value={groupSize}
          onChange={(e) => setGroupSize(Number(e.target.value))}
          className="accent-primary w-full"
        />
        <div className="text-muted-foreground mt-0.5 flex justify-between text-[10px]">
          <span>1</span>
          <span>20+</span>
        </div>
      </div>

      {/* price pills */}
      <div className="mb-4">
        <p className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-widest">
          Price
        </p>
        <div className="flex gap-2">
          {(['all', 'free', 'paid'] as PriceFilter[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPriceFilter(p)}
              className={`flex-1 rounded-full border px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                priceFilter === p
                  ? 'bg-primary text-primary-foreground border-transparent'
                  : 'bg-card border-border hover:bg-muted'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* vibes dropdown */}
      <div className="mb-5">
        <p className="text-muted-foreground mb-1.5 text-xs font-semibold uppercase tracking-widest">
          Vibes
        </p>
        <select
          value={vibeFilter}
          onChange={(e) => setVibeFilter(e.target.value)}
          className={selectCls}
        >
          {VIBE_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* action buttons */}
      <button
        type="button"
        className="bg-primary text-primary-foreground hover:brightness-110 w-full rounded-full py-2.5 text-sm font-semibold transition-[filter]"
      >
        Apply Filters
      </button>
      <button
        type="button"
        className="border-border hover:bg-muted mt-2 flex w-full items-center justify-center gap-1.5 rounded-full border py-2.5 text-sm font-semibold transition-colors"
      >
        <i className="fa-solid fa-bookmark text-primary" />
        Save Search
      </button>
    </aside>
  );
}

/* ─── inner component (uses useSearchParams) ─────────────────────────── */

function SearchInner() {
  const { user } = useAuth();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const seedBrowse = peekCache<TableDto[]>(tablesCacheKeys(user?.id).browse);
  const [tables, setTables] = useState<TableDto[] | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const rawBrowse = tables ?? seedBrowse ?? null;
  const tablesView = rawBrowse == null ? null : upcomingDiscoverTables(rawBrowse);

  // filter state
  const [location, setLocation] = useState('Islamabad, Pakistan');
  const [dateFilter, setDateFilter] = useState('any');
  const [timeFilter, setTimeFilter] = useState('any');
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [groupSize, setGroupSize] = useState(10);
  const [priceFilter, setPriceFilter] = useState<PriceFilter>('all');
  const [vibeFilter, setVibeFilter] = useState('any');
  const [sortKey, setSortKey] = useState<SortKey>('relevant');
  const [view, setView] = useState<ViewMode>('list');

  const toggleCat = (c: string) =>
    setSelectedCats((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  const resetFilters = () => {
    setLocation('Islamabad, Pakistan');
    setDateFilter('any');
    setTimeFilter('any');
    setSelectedCats([]);
    setGroupSize(10);
    setPriceFilter('all');
    setVibeFilter('any');
    setQ('');
  };

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (p) => setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {},
    );
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const list = await swrGet(tablesCacheKeys(user?.id).browse, () =>
          api.browseTables(),
        );
        if (active) setTables(list);
      } catch {
        if (active) setTables([]);
      }
    })();
    return () => { active = false; };
  }, [user]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = (tablesView ?? []).filter((t) => {
      if (
        selectedCats.length > 0 &&
        !selectedCats.some((c) =>
          splitCategories(t.category).some(
            (part) => part.toLowerCase() === c.toLowerCase(),
          ),
        )
      ) {
        return false;
      }
      if (!matchesPrice(t, priceFilter)) return false;
      if (!matchesDate(t, dateFilter)) return false;
      if (!matchesTime(t, timeFilter)) return false;
      if (needle) {
        const hay =
          `${t.title ?? ''} ${t.category} ${t.venueName ?? ''} ${t.cafe?.name ?? ''} ${t.description ?? ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    return sortResults(filtered, sortKey);
  }, [tablesView, q, selectedCats, priceFilter, dateFilter, timeFilter, sortKey]);

  return (
    <main className="mx-auto w-full max-w-[1508px] flex-1 px-4 sm:px-6 lg:px-12 py-6">
      <div className="grid gap-6 lg:grid-cols-[260px_1fr_320px]">

        {/* ── LEFT FILTERS ─────────────────────────────────────────── */}
        <FilterPanel
          location={location} setLocation={setLocation}
          dateFilter={dateFilter} setDateFilter={setDateFilter}
          timeFilter={timeFilter} setTimeFilter={setTimeFilter}
          selectedCats={selectedCats} toggleCat={toggleCat}
          groupSize={groupSize} setGroupSize={setGroupSize}
          priceFilter={priceFilter} setPriceFilter={setPriceFilter}
          vibeFilter={vibeFilter} setVibeFilter={setVibeFilter}
          onReset={resetFilters}
          onApply={() => {/* filters already reactive */}}
        />

        {/* ── CENTER ───────────────────────────────────────────────── */}
        <div className="order-1 min-w-0 space-y-5 lg:order-2">
          {/* search bar row */}
          <div className="relative">
            <i className="fa-solid fa-magnifying-glass text-muted-foreground pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm" />
            <Input
              placeholder="Search meetups, topics, venues…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-10 pr-10"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ('')}
                className="text-muted-foreground hover:text-foreground absolute right-4 top-1/2 -translate-y-1/2 text-sm transition-colors"
                aria-label="Clear search"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            )}
          </div>

          {/* header row */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="display font-heading text-2xl font-extrabold tracking-tight">
                Search results
              </h2>
              {tables !== null && (
                <p className="text-muted-foreground text-sm">
                  {results.length} meetup{results.length !== 1 ? 's' : ''} found
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              {/* sort */}
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground text-xs font-semibold">Sort by:</span>
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                  className="border-input bg-card/60 focus-visible:border-ring rounded-xl border px-2.5 py-1.5 text-xs outline-none focus-visible:ring-2"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              {/* list/grid toggle */}
              <div className="flex overflow-hidden rounded-xl border">
                <button
                  type="button"
                  onClick={() => setView('list')}
                  className={`px-3 py-1.5 text-sm transition-colors ${
                    view === 'list'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card hover:bg-muted text-muted-foreground'
                  }`}
                  aria-label="List view"
                >
                  <i className="fa-solid fa-list" />
                </button>
                <button
                  type="button"
                  onClick={() => setView('grid')}
                  className={`px-3 py-1.5 text-sm transition-colors ${
                    view === 'grid'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card hover:bg-muted text-muted-foreground'
                  }`}
                  aria-label="Grid view"
                >
                  <i className="fa-solid fa-grip" />
                </button>
              </div>
            </div>
          </div>

          <ContentPlaceholder
            loading={tablesView === null}
            skeleton={<TableCardGridSkeleton count={6} />}
          >
          {tables !== null && results.length === 0 && (
            <div className="rounded-3xl border border-dashed py-16 text-center">
              <p className="text-4xl">🔎</p>
              <p className="text-muted-foreground mt-3 text-sm">No meetups match your search.</p>
              <button
                type="button"
                onClick={resetFilters}
                className="text-primary mt-2 text-sm font-semibold hover:underline"
              >
                Reset all filters →
              </button>
            </div>
          )}

          {/* results list view */}
          {results.length > 0 && view === 'list' && (
            <StaggerIn className="space-y-3" deps={[results.length, view]}>
              {results.map((t) => (
                <TableListRow key={t.id} t={t} />
              ))}
            </StaggerIn>
          )}

          {/* results grid view */}
          {results.length > 0 && view === 'grid' && (
            <StaggerIn
              className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
              deps={[results.length, view]}
            >
              {results.map((t) => (
                <TableCoverCard key={t.id} t={t} coords={coords} viewerId={user?.id} />
              ))}
            </StaggerIn>
          )}
          </ContentPlaceholder>
        </div>

        {/* ── RIGHT RAIL ───────────────────────────────────────────── */}
        <aside className="order-3 max-lg:hidden space-y-4 lg:sticky lg:top-24 lg:self-start">
          <MapPreview results={results} />
          <MightLike tables={tables ?? []} />
        </aside>
      </div>
    </main>
  );
}

/* ─── page export (Suspense boundary required for useSearchParams) ─── */

export default function SearchPage() {
  return (
    <Suspense fallback={<TableCardGridSkeleton count={6} />}>
      <SearchInner />
    </Suspense>
  );
}
