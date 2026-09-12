'use client';

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import Link from 'next/link';
import { ApiError, type TableDto } from '@jrst/api-client';
import { useAuth } from '@/components/auth-provider';
import { api } from '@/lib/api';
import { peekCache, swrGet, tablesCacheKeys } from '@/lib/data-cache';
import { formatDateTime, formatPKR } from '@/lib/format';
import { Cover } from '@/components/cover-image';
import { Avatar } from '@/components/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { categoryIcon, splitCategories } from '@/lib/category-icon';
import { CategoryPills } from '@/components/category-pills';
import { SideDrawer } from '@/components/side-drawer';
import { EmptyMascot } from '@/components/empty-mascot';
import { StaggerIn } from '@/components/stagger-in';
import { haversineKm, formatDistance, googleMapsUrl } from '@/lib/geo';
import { tableCta } from '@/lib/table-cta';
import { upcomingDiscoverTables } from '@/lib/table-time';

/* ─── types ──────────────────────────────────────────────────────── */

type PriceTier = 'any' | 'free' | 'under200' | '200to500' | 'above500';
type WhenFilter = 'anytime' | 'today' | 'week' | 'weekend' | 'custom';

/* ─── distance filter ────────────────────────────────────────────── */

function matchesDistance(
  t: TableDto,
  coords: { lat: number; lng: number } | null,
  maxKm: number,
): boolean {
  if (maxKm >= 50) return true; // slider maxed = "50+ km" = no distance limit
  if (!coords) return true; // geolocation not available → pass all
  const tLat = t.lat ?? t.cafe?.lat ?? null;
  const tLng = t.lng ?? t.cafe?.lng ?? null;
  if (tLat == null || tLng == null) return true; // no coords on table → pass
  return haversineKm(coords.lat, coords.lng, tLat, tLng) <= maxKm;
}

const CITIES = ['Islamabad', 'Lahore', 'Karachi', 'Rawalpindi'] as const;

// City centers — a table is attributed to the nearest one by its coordinates.
const CITY_COORDS: Record<(typeof CITIES)[number], { lat: number; lng: number }> = {
  Islamabad: { lat: 33.6844, lng: 73.0479 },
  Lahore: { lat: 31.5497, lng: 74.3436 },
  Karachi: { lat: 24.8607, lng: 67.0011 },
  Rawalpindi: { lat: 33.5651, lng: 73.0169 },
};

function nearestCity(t: TableDto): string | null {
  const lat = t.lat ?? t.cafe?.lat ?? null;
  const lng = t.lng ?? t.cafe?.lng ?? null;
  if (lat == null || lng == null) return null;
  let best: string | null = null;
  let bestKm = Infinity;
  for (const [city, c] of Object.entries(CITY_COORDS)) {
    const d = haversineKm(lat, lng, c.lat, c.lng);
    if (d < bestKm) {
      bestKm = d;
      best = city;
    }
  }
  return best;
}

const NOW = Date.now();

function matchesPrice(t: TableDto, tier: PriceTier): boolean {
  if (tier === 'any') return true;
  if (tier === 'free') return t.pricePKR == null || t.pricePKR === 0;
  if (tier === 'under200') return t.pricePKR != null && t.pricePKR > 0 && t.pricePKR < 200;
  if (tier === '200to500') return t.pricePKR != null && t.pricePKR >= 200 && t.pricePKR <= 500;
  if (tier === 'above500') return t.pricePKR != null && t.pricePKR > 500;
  return true;
}

function matchesWhen(t: TableDto, when: WhenFilter, customDate: string): boolean {
  const start = new Date(t.startAt).getTime();
  // Public explore is upcoming-only — past tables belong on Meetups / profile.
  if (start <= NOW) return false;
  if (when === 'anytime') return true;
  if (when === 'today') {
    const todayStart = new Date(NOW).setHours(0, 0, 0, 0);
    const todayEnd = todayStart + 86400_000;
    return start >= todayStart && start < todayEnd;
  }
  if (when === 'week') {
    return start >= NOW && start <= NOW + 7 * 86400_000;
  }
  if (when === 'weekend') {
    if (start < NOW) return false;
    const day = new Date(start).getDay();
    return day === 0 || day === 6;
  }
  if (when === 'custom' && customDate) {
    const from = new Date(customDate).setHours(0, 0, 0, 0);
    const to = from + 86400_000;
    return start >= from && start < to;
  }
  return true;
}

function cityCount(tables: TableDto[], city: string): number {
  return tables.filter((t) => nearestCity(t) === city).length;
}

/* ─── SkeletonCard ───────────────────────────────────────────────── */

function SkeletonCard() {
  return (
    <div className="bg-card shadow-soft ring-border/60 flex h-full flex-col overflow-hidden rounded-3xl ring-1">
      {/* image block */}
      <div className="bg-muted animate-pulse h-40 shrink-0 rounded-t-3xl" />
      <div className="flex flex-1 flex-col p-4 gap-3">
        {/* title */}
        <div className="bg-muted animate-pulse h-4 w-3/4 rounded" />
        {/* date */}
        <div className="bg-muted animate-pulse h-3 w-1/2 rounded" />
        {/* venue */}
        <div className="bg-muted animate-pulse h-3 w-2/3 rounded" />
        {/* host */}
        <div className="bg-muted animate-pulse h-3 w-2/5 rounded" />
        {/* badge + price row */}
        <div className="mt-auto flex items-center justify-between pt-1">
          <div className="bg-muted animate-pulse h-5 w-20 rounded-full" />
          <div className="bg-muted animate-pulse h-5 w-14 rounded" />
        </div>
        {/* cta button */}
        <div className="bg-muted animate-pulse h-9 w-full rounded-full" />
      </div>
    </div>
  );
}

/* ─── TableCoverCard ─────────────────────────────────────────────── */

function TableCoverCard({
  t,
  coords,
  viewerId,
}: {
  t: TableDto;
  coords: { lat: number; lng: number } | null;
  viewerId?: string | null;
}) {
  const low = t.seatsLeft > 0 && t.seatsLeft <= 2;
  const cta = tableCta(t, viewerId);
  const tLat = t.lat ?? t.cafe?.lat ?? null;
  const tLng = t.lng ?? t.cafe?.lng ?? null;
  return (
    <Link
      href={`/tables/${t.id}`}
      className="bg-card shadow-soft ring-border/60 group flex h-full flex-col overflow-hidden rounded-3xl ring-1 transition-all hover:-translate-y-0.5 hover:shadow-glow"
    >
      <div className="relative h-40 shrink-0">
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
      <div className="flex flex-1 flex-col p-4">
        <h3 className="font-heading text-base font-bold tracking-tight">{t.title ?? t.category}</h3>
        <p className="text-muted-foreground mt-1 flex items-center gap-1 text-sm">
          <i className="fa-solid fa-calendar-day" /> {formatDateTime(t.startAt)}
        </p>
        <p className="text-muted-foreground mt-1 flex items-center gap-1 text-sm">
          <i className="fa-solid fa-location-dot" />
          {t.venueName ?? t.cafe?.name ?? 'See map'}
          {coords && tLat != null && tLng != null && (
            <> · {formatDistance(haversineKm(coords.lat, coords.lng, tLat, tLng))}</>
          )}
          {tLat != null && tLng != null && (() => {
            const lat = tLat;
            const lng = tLng;
            return (
              <button
                type="button"
                aria-label="Open location in Google Maps"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(googleMapsUrl(lat, lng), '_blank', 'noopener'); }}
                className="text-primary hover:text-primary/80 ml-1"
              >
                <i className="fa-solid fa-map-pin" />
              </button>
            );
          })()}
        </p>
        <div className="text-muted-foreground mt-2 flex items-center gap-1.5 text-xs">
          <Avatar name={t.host?.username ?? 'member'} size={22} />
          Hosted by @{t.host?.username ?? 'member'}
        </div>
        <div className="mt-auto flex items-center justify-between pt-3">
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

/* ─── filters panel (desktop aside + mobile drawer) ──────────────── */

type DiscoverFiltersPanelProps = {
  q: string;
  setQ: Dispatch<SetStateAction<string>>;
  category: string;
  setCategory: Dispatch<SetStateAction<string>>;
  categories: string[];
  when: WhenFilter;
  setWhen: Dispatch<SetStateAction<WhenFilter>>;
  customDate: string;
  setCustomDate: Dispatch<SetStateAction<string>>;
  distanceKm: number;
  setDistanceKm: Dispatch<SetStateAction<number>>;
  coords: { lat: number; lng: number } | null;
  priceTier: PriceTier;
  setPriceTier: Dispatch<SetStateAction<PriceTier>>;
  clearFilters: () => void;
  onApply?: () => void;
};

function DiscoverFiltersPanel({
  q,
  setQ,
  category,
  setCategory,
  categories,
  when,
  setWhen,
  customDate,
  setCustomDate,
  distanceKm,
  setDistanceKm,
  coords,
  priceTier,
  setPriceTier,
  clearFilters,
  onApply,
}: DiscoverFiltersPanelProps) {
  const PRICE_TIERS: { id: PriceTier; label: string }[] = [
    { id: 'any', label: 'Any Price' },
    { id: 'free', label: 'Free' },
    { id: 'under200', label: 'Under PKR 200' },
    { id: '200to500', label: 'PKR 200–500' },
    { id: 'above500', label: 'Above PKR 500' },
  ];

  const WHEN_OPTS: { id: WhenFilter; label: string }[] = [
    { id: 'anytime', label: 'Anytime' },
    { id: 'today', label: 'Today' },
    { id: 'week', label: 'This Week' },
    { id: 'weekend', label: 'This Weekend' },
    { id: 'custom', label: 'Custom Range' },
  ];

  return (
    <>
      <div className="mb-4 flex justify-end lg:hidden">
        <button
          type="button"
          onClick={clearFilters}
          className="text-primary text-xs font-semibold hover:underline"
        >
          Clear all
        </button>
      </div>

      <div className="mb-5">
        <Input
          placeholder="🔍 Meetups, topics, venues…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="mb-5">
        <p className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-widest">
          Vibes / Topics
        </p>
        <ul className="space-y-0.5">
          <li>
            <button
              type="button"
              onClick={() => setCategory('')}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
                category === ''
                  ? 'bg-secondary text-primary'
                  : 'hover:bg-muted text-foreground'
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
                onClick={() => setCategory(category === c ? '' : c)}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
                  category === c
                    ? 'bg-secondary text-primary'
                    : 'hover:bg-muted text-foreground'
                }`}
              >
                <i className={`fa-solid ${categoryIcon(c)} w-4 text-center`} />
                {c}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="mb-5">
        <p className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-widest">
          When
        </p>
        <ul className="space-y-0.5">
          {WHEN_OPTS.map((opt) => (
            <li key={opt.id}>
              <button
                type="button"
                onClick={() => setWhen(opt.id)}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors ${
                  when === opt.id
                    ? 'bg-primary/10 text-primary font-semibold'
                    : 'hover:bg-muted text-foreground'
                }`}
              >
                <span
                  className={`inline-block size-3.5 shrink-0 rounded-full border-2 ${
                    when === opt.id
                      ? 'border-primary bg-primary'
                      : 'border-muted-foreground/40'
                  }`}
                />
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
        {when === 'custom' && (
          <input
            type="date"
            value={customDate}
            onChange={(e) => setCustomDate(e.target.value)}
            className="border-border focus:ring-primary mt-2 w-full rounded-xl border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2"
          />
        )}
      </div>

      <div className="mb-5">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-muted-foreground text-xs font-semibold uppercase tracking-widest">
            Distance
          </p>
          <span className="text-xs font-semibold">
            {distanceKm >= 50 ? '50+ km' : `${distanceKm} km`}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={50}
          value={distanceKm}
          onChange={(e) => setDistanceKm(Number(e.target.value))}
          className="accent-primary w-full"
        />
        <div className="text-muted-foreground mt-1 flex justify-between text-[10px]">
          <span>0 km</span>
          <span>50+ km</span>
        </div>
        {!coords && (
          <p className="text-muted-foreground mt-1.5 text-[10px]">
            Enable location to filter by distance
          </p>
        )}
      </div>

      <div className="mb-5">
        <p className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-widest">
          Price Range
        </p>
        <ul className="space-y-0.5">
          {PRICE_TIERS.map(({ id, label }) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => setPriceTier(id)}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors ${
                  priceTier === id
                    ? 'bg-primary text-primary-foreground font-semibold'
                    : 'hover:bg-muted text-foreground'
                }`}
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <button
        type="button"
        onClick={() => onApply?.()}
        className="bg-primary text-primary-foreground hover:brightness-110 w-full rounded-full py-2.5 text-sm font-semibold transition-[filter] lg:hidden"
      >
        Apply Filters
      </button>
    </>
  );
}

/* ─── page ───────────────────────────────────────────────────────── */

export default function DiscoverPage() {
  const { user } = useAuth();

  const [tables, setTables] = useState<TableDto[] | null>(
    () => peekCache<TableDto[]>(tablesCacheKeys(user?.id).browse) ?? null,
  );
  const [myJoined, setMyJoined] = useState<TableDto[]>(
    () => peekCache<TableDto[]>(tablesCacheKeys(user?.id).joined) ?? [],
  );
  const [error, setError] = useState<string | null>(null);

  // Re-seed on render when auth resolves / cache fills (no effect setState).
  const seedBrowse = peekCache<TableDto[]>(tablesCacheKeys(user?.id).browse);
  const seedJoined = peekCache<TableDto[]>(tablesCacheKeys(user?.id).joined);
  const rawBrowse = tables ?? seedBrowse ?? null;
  const tablesView = rawBrowse == null ? null : upcomingDiscoverTables(rawBrowse);
  const myJoinedView = myJoined.length > 0 ? myJoined : (seedJoined ?? []);

  // filters
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [priceTier, setPriceTier] = useState<PriceTier>('any');
  const [when, setWhen] = useState<WhenFilter>('anytime');
  const [customDate, setCustomDate] = useState('');
  const [distanceKm, setDistanceKm] = useState(50); // 50 = "50+" = no limit (show all)
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const keys = tablesCacheKeys(user?.id);

    void (async () => {
      try {
        const browsePromise = swrGet(keys.browse, () => api.browseTables());
        const joinedPromise = user
          ? swrGet(keys.joined, () => api.myJoinedTables()).catch(
              () => [] as TableDto[],
            )
          : Promise.resolve([] as TableDto[]);
        const [list, joined] = await Promise.all([browsePromise, joinedPromise]);
        if (active) {
          setTables(list);
          setMyJoined(joined);
        }
      } catch (err) {
        if (active) setError(err instanceof ApiError ? err.message : 'Failed to load meetups');
      }
    })();
    return () => {
      active = false;
    };
  }, [user]);

  // geolocation — request once on mount
  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (p) => setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {}, // denied/unavailable → coords stays null
      { timeout: 8000 },
    );
  }, []);

  const categories = useMemo(
    () => [...new Set((tablesView ?? []).flatMap((t) => splitCategories(t.category)))].sort(),
    [tablesView],
  );

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (tablesView ?? []).filter((t) => {
      if (category && !splitCategories(t.category).includes(category)) return false;
      if (!matchesPrice(t, priceTier)) return false;
      if (!matchesWhen(t, when, customDate)) return false;
      if (!matchesDistance(t, coords, distanceKm)) return false;
      if (needle) {
        const hay =
          `${t.title ?? ''} ${t.category} ${t.venueName ?? ''} ${t.cafe?.name ?? ''} ${t.description ?? ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [tablesView, q, category, priceTier, when, customDate, coords, distanceKm]);

  // split into recommended (first 4) + more
  const recommended = results.slice(0, 3);
  const more = results.slice(3);

  // top categories by table count
  const catCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of tablesView ?? []) {
      for (const c of splitCategories(t.category)) {
        counts[c] = (counts[c] ?? 0) + 1;
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [tablesView]);

  // upcoming joined tables (future, APPROVED or PENDING)
  const upcomingJoined = useMemo(
    () =>
      myJoinedView
        .filter(
          (t) =>
            (t.myRequestStatus === 'APPROVED' || t.myRequestStatus === 'PENDING') &&
            new Date(t.startAt).getTime() > NOW,
        )
        .slice(0, 2),
    [myJoinedView],
  );

  const resetFilters = () => {
    setQ('');
    setCategory('');
    setPriceTier('any');
    setWhen('anytime');
    setCustomDate('');
    setDistanceKm(50);
  };

  const openCount = tables?.length ?? 0;

  const filterProps = {
    q,
    setQ,
    category,
    setCategory,
    categories,
    when,
    setWhen,
    customDate,
    setCustomDate,
    distanceKm,
    setDistanceKm,
    coords,
    priceTier,
    setPriceTier,
    clearFilters: resetFilters,
  };

  return (
    <main className="mx-auto w-full max-w-[1508px] flex-1 px-4 py-6 sm:px-6">
      <div className="grid gap-6 lg:grid-cols-[240px_1fr_300px]">
        {/* ── LEFT RAIL (desktop) ───────────────────────────────────── */}
        <aside className="scrollbar-hidden bg-card shadow-soft hidden rounded-3xl border p-5 lg:sticky lg:top-24 lg:block lg:self-start lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
          <div className="mb-4 flex items-center justify-between gap-2">
            <p className="font-heading font-bold tracking-tight">Filters</p>
            <button
              type="button"
              onClick={resetFilters}
              className="text-primary text-xs font-semibold hover:underline"
            >
              Clear all
            </button>
          </div>
          <DiscoverFiltersPanel {...filterProps} />
        </aside>

        {/* ── MAIN ──────────────────────────────────────────────────── */}
        <div className="min-w-0 space-y-8">
          {/* mobile toolbar */}
          <div className="flex items-center gap-2 lg:hidden">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setFilterDrawerOpen(true)}
              className="w-auto shrink-0"
            >
              <i className="fa-solid fa-sliders mr-2" />
              Filters
            </Button>
          </div>

          {/* HERO */}
          <section className="bg-ink relative overflow-hidden rounded-3xl p-5 text-white shadow-glow sm:p-8">
            {/* café-conversation photo from the design, full-bleed on the right */}
            <div aria-hidden className="pointer-events-none absolute inset-0">
              {/* eslint-disable-next-line @next/next/no-img-element -- static bundled hero photo */}
              <img
                src="/hero-explore.jpg"
                alt=""
                className="ml-auto hidden h-full w-3/5 object-cover sm:block sm:w-1/2"
              />
              <div className="from-ink via-ink/85 to-ink/10 absolute inset-0 bg-gradient-to-r via-45% max-sm:via-ink/95" />
            </div>
            <div className="relative">
              <p className="eyebrow flex items-center gap-1.5 text-white/60">
                <i className="fa-solid fa-wand-magic-sparkles" /> Explore &amp; Connect
              </p>
              <h2 className="display font-heading mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">
                Discover conversations{' '}
                <span className="text-primary">that matter</span>
              </h2>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-white/70">
                Find like-minded people, join interesting meetups and make meaningful connections.
              </p>
              {tables && (
                <span className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/20">
                  <span className="bg-primary inline-block size-2 rounded-full" />
                  {openCount} {openCount === 1 ? 'meetup' : 'meetups'} open now
                </span>
              )}
            </div>
          </section>

          {/* TOP CATEGORIES — compact horizontal scroll on mobile */}
          {catCounts.length > 0 && (
            <section>
              <div className="mb-3 lg:mb-4">
                <h2 className="font-heading text-lg font-bold tracking-tight lg:text-xl">
                  Top categories
                </h2>
              </div>
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:mx-0 lg:flex-wrap lg:gap-3 lg:overflow-visible lg:px-0 lg:pb-0">
                {catCounts.map(([cat, count]) => {
                  const active = category === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCategory(active ? '' : cat)}
                      className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors lg:gap-2.5 lg:rounded-2xl lg:px-4 lg:py-3 lg:text-sm lg:transition-all lg:hover:-translate-y-0.5 lg:hover:shadow-soft ${
                        active
                          ? 'bg-primary text-primary-foreground border-transparent lg:shadow-glow'
                          : 'bg-card border-border/60'
                      }`}
                    >
                      <span
                        className={`grid size-6 shrink-0 place-items-center rounded-full text-[11px] lg:size-8 lg:rounded-xl lg:text-sm ${
                          active ? 'bg-white/20' : 'bg-primary/10'
                        }`}
                      >
                        <i
                          className={`fa-solid ${categoryIcon(cat)} ${active ? 'text-white' : 'text-primary'}`}
                        />
                      </span>
                      <span className="flex items-center gap-1.5 lg:flex-col lg:items-start lg:gap-0 lg:leading-tight">
                        <span>{cat}</span>
                        <span
                          className={`font-normal tabular-nums lg:text-[10px] ${
                            active ? 'text-white/70' : 'text-muted-foreground'
                          }`}
                        >
                          <span className="lg:hidden">· {count}</span>
                          <span className="hidden lg:inline">
                            {count} {count === 1 ? 'meetup' : 'meetups'}
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* loading / error / empty */}
          {error && <p className="text-destructive text-sm">{error}</p>}
          {!tables && !error && (
            <section>
              <div className="mb-4">
                <div className="bg-muted animate-pulse h-6 w-48 rounded" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            </section>
          )}
          {tables && results.length === 0 && (
            <EmptyMascot
              quip="Hmm… no meetups in that filter."
              title="No meetups match your filters"
              description="Try clearing filters or pick another vibe."
              action={
                <button
                  type="button"
                  onClick={resetFilters}
                  className="text-primary text-sm font-semibold hover:underline"
                >
                  Clear filters
                </button>
              }
            />
          )}

          {/* RECOMMENDED FOR YOU */}
          {recommended.length > 0 && (
            <section>
              <div className="mb-4">
                <h2 className="font-heading text-xl font-bold tracking-tight">
                  Recommended for you
                </h2>
              </div>
              <StaggerIn
                className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
                deps={[recommended.map((t) => t.id).join(',')]}
              >
                {recommended.map((t) => (
                  <TableCoverCard key={t.id} t={t} coords={coords} viewerId={user?.id} />
                ))}
              </StaggerIn>
            </section>
          )}

          {/* MORE TABLES YOU MIGHT LIKE */}
          {more.length > 0 && (
            <section>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-heading text-xl font-bold tracking-tight">
                  More meetups you might like
                </h2>
              </div>
              <StaggerIn
                className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
                deps={[more.map((t) => t.id).join(',')]}
              >
                {more.map((t) => (
                  <TableCoverCard key={t.id} t={t} coords={coords} viewerId={user?.id} />
                ))}
              </StaggerIn>
            </section>
          )}
        </div>

        {/* ── RIGHT RAIL ────────────────────────────────────────────── */}
        <aside className="scrollbar-hidden space-y-4 max-lg:hidden lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-1">
          {/* TRENDING NOW */}
          <div className="bg-card shadow-soft rounded-3xl border p-5">
            <div className="mb-3">
              <p className="font-heading font-bold tracking-tight">🔥 Trending now</p>
            </div>
            {tablesView === null ? (
              <ul className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <li key={i} className="flex items-center gap-3 py-2">
                    <div className="bg-muted animate-pulse size-8 shrink-0 rounded-xl" />
                    <div className="flex-1 space-y-1.5">
                      <div className="bg-muted animate-pulse h-3 w-3/4 rounded" />
                      <div className="bg-muted animate-pulse h-2.5 w-1/2 rounded" />
                    </div>
                    <div className="bg-muted animate-pulse h-3 w-5 rounded" />
                  </li>
                ))}
              </ul>
            ) : catCounts.length === 0 ? (
              <p className="text-muted-foreground text-sm">No trending topics yet.</p>
            ) : (
              <ul className="space-y-2">
                {catCounts.slice(0, 5).map(([cat, count], i) => (
                  <li key={cat}>
                    <button
                      type="button"
                      onClick={() => setCategory(category === cat ? '' : cat)}
                      className="hover:bg-muted -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-2xl px-2 py-2 text-left transition-colors"
                    >
                      <span className="bg-primary/10 grid size-8 shrink-0 place-items-center rounded-xl">
                        <i className={`fa-solid ${categoryIcon(cat)} text-primary text-xs`} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{cat}</p>
                        <p className="text-muted-foreground text-xs">
                          {count} {count === 1 ? 'table' : 'tables'}
                        </p>
                      </div>
                      <span className="text-muted-foreground text-xs font-bold">#{i + 1}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* YOUR UPCOMING */}
          <div className="bg-card shadow-soft rounded-3xl border p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-heading font-bold tracking-tight">Your upcoming</p>
              <Link href="/meetups" className="text-primary text-xs font-semibold hover:underline">
                View all
              </Link>
            </div>
            {upcomingJoined.length === 0 ? (
              <div className="rounded-2xl border border-dashed py-5 text-center">
                <p className="text-muted-foreground text-xs">No upcoming meetups yet.</p>
                <Link
                  href="/discover"
                  className="text-primary mt-1 block text-xs font-semibold hover:underline"
                >
                  Find a meetup →
                </Link>
              </div>
            ) : (
              <ul className="space-y-2">
                {upcomingJoined.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/tables/${t.id}`}
                      className="hover:bg-muted -mx-2 flex items-center gap-3 rounded-2xl px-2 py-2 transition-colors"
                    >
                      <span className="bg-secondary grid size-9 shrink-0 place-items-center rounded-xl">
                        <i className={`fa-solid ${categoryIcon(t.category)} text-primary`} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-heading truncate text-sm font-bold">
                          {t.title ?? t.category}
                        </p>
                        <p className="text-muted-foreground truncate text-xs">
                          {formatDateTime(t.startAt)}
                        </p>
                        <p className="text-muted-foreground flex items-center gap-1 truncate text-xs">
                          <i className="fa-solid fa-location-dot" /> {t.venueName ?? t.cafe?.name ?? 'See map'}
                        </p>
                      </div>
                      <span className="text-muted-foreground shrink-0">→</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* POPULAR CITIES */}
          <div className="bg-card shadow-soft rounded-3xl border p-5">
            <div className="mb-3">
              <p className="font-heading font-bold tracking-tight">Popular cities</p>
            </div>
            <ul className="space-y-2">
              {CITIES.map((city) => (
                <li key={city} className="flex items-center gap-3">
                  <span className="bg-primary/10 grid size-8 shrink-0 place-items-center rounded-xl">
                    <i className="fa-solid fa-city text-primary text-xs" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{city}</p>
                    {tablesView === null ? (
                      <div className="bg-muted animate-pulse mt-1 h-2.5 w-16 rounded" />
                    ) : (
                      <p className="text-muted-foreground text-xs">
                        {cityCount(tablesView ?? [], city)}{' '}
                        {cityCount(tablesView ?? [], city) === 1 ? 'meetup' : 'meetups'}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>

      <SideDrawer
        open={filterDrawerOpen}
        onClose={() => setFilterDrawerOpen(false)}
        side="left"
        title="Filters"
      >
        <DiscoverFiltersPanel
          {...filterProps}
          onApply={() => setFilterDrawerOpen(false)}
        />
      </SideDrawer>
    </main>
  );
}
