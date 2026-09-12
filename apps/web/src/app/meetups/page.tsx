'use client';

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError, type InviteDto, type PublicUser, type TableDto } from '@jrst/api-client';
import { useAuth } from '@/components/auth-provider';
import { api } from '@/lib/api';
import {
  invalidateTablesClientCache,
  peekCache,
  swrGet,
  tablesCacheKeys,
} from '@/lib/data-cache';
import { tableCta } from '@/lib/table-cta';
import { formatDateTime, formatPKR } from '@/lib/format';
import { Cover } from '@/components/cover-image';
import { Avatar } from '@/components/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { categoryIcon, splitCategories } from '@/lib/category-icon';
import { CategoryPills } from '@/components/category-pills';
import { SideDrawer } from '@/components/side-drawer';
import { EmptyMascot } from '@/components/empty-mascot';
import { StaggerIn } from '@/components/stagger-in';
import { haversineKm, formatDistance } from '@/lib/geo';

/* ─── helpers ───────────────────────────────────────────────────── */

const personName = (u: { username?: string | null }) =>
  `@${u.username ?? 'member'}`;

const NOW = Date.now();

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date(NOW);
  const tomorrow = new Date(NOW);
  tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short' });
}

type WhenFilter = 'all' | 'upcoming' | 'week' | 'weekend' | 'past';
type TabId = 'upcoming' | 'my' | 'invitations' | 'past' | 'saved';

function applyFilters(
  tables: TableDto[],
  when: WhenFilter,
  category: string,
  fromDate: string,
  toDate: string,
  coords: { lat: number; lng: number } | null,
  radiusKm: number,
): TableDto[] {
  return tables.filter((t) => {
    const start = new Date(t.startAt).getTime();
    const now = NOW;

    // Cancelled tables are void — never surface them in any view.
    if (t.status === 'CANCELLED') return false;
    // Completed tables belong only to the "past" view.
    if (when !== 'past' && t.status === 'COMPLETED') return false;

    // Public "all" still hides ended tables; only the Past preset shows them.
    if (when !== 'past' && start < now) return false;
    // when filter
    if (when === 'upcoming' && start < now) return false;
    if (when === 'past' && start >= now) return false;
    if (when === 'week') {
      if (start < now || start > now + 7 * 86400_000) return false;
    }
    if (when === 'weekend') {
      if (start < now) return false;
      const day = new Date(start).getDay();
      if (day !== 0 && day !== 6) return false;
    }

    // category filter (match any part of a multi-category table)
    if (category && !splitCategories(t.category).includes(category)) return false;

    // date from filter
    if (fromDate) {
      const from = new Date(fromDate).setHours(0, 0, 0, 0);
      if (start < from) return false;
    }

    // date to filter
    if (toDate) {
      const to = new Date(toDate).setHours(23, 59, 59, 999);
      if (start > to) return false;
    }

    // radius filter — only when coords known and limit is set (< 50 = unlimited sentinel)
    if (coords !== null && radiusKm < 50) {
      const tLat = t.lat ?? t.cafe?.lat ?? null;
      const tLng = t.lng ?? t.cafe?.lng ?? null;
      if (tLat !== null && tLng !== null) {
        const dist = haversineKm(coords.lat, coords.lng, tLat, tLng);
        if (dist > radiusKm) return false;
      }
      // if no coords on the table, keep it
    }

    return true;
  });
}

/* ─── calendar ──────────────────────────────────────────────────── */

const DOT_COLOR: Record<string, string> = {
  'Deep talks': 'bg-purple-500',
  'Coffee & chill': 'bg-primary',
  Startups: 'bg-amber-500',
  'Language exchange': 'bg-blue-500',
  Networking: 'bg-rose-500',
  Books: 'bg-emerald-500',
  'Board games': 'bg-teal-500',
};

function calendarDotClass(category: string): string {
  return DOT_COLOR[category] ?? 'bg-primary';
}

function CalendarCard({ joined }: { joined: TableDto[] }) {
  const today = new Date(NOW);
  const year = today.getFullYear();
  const month = today.getMonth();
  const monthLabel = today.toLocaleDateString('en-PK', { month: 'long', year: 'numeric' });
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Monday=1…Sunday=0 → we want Mon=0…Sun=6
  const rawFirst = new Date(year, month, 1).getDay();
  const blanks = rawFirst === 0 ? 6 : rawFirst - 1;

  // day-of-month → dot color class (first meetup that day wins)
  const dayDotMap = new Map<number, string>();
  for (const t of joined) {
    const d = new Date(t.startAt);
    if (d.getFullYear() === year && d.getMonth() === month) {
      const day = d.getDate();
      if (!dayDotMap.has(day)) {
        dayDotMap.set(day, calendarDotClass(t.category));
      }
    }
  }

  return (
    <div className="bg-card shadow-soft rounded-3xl border p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-heading font-bold tracking-tight">Calendar</p>
        <Link href="/calendar" className="text-muted-foreground text-xs hover:underline">
          View full calendar
        </Link>
      </div>
      <p className="text-muted-foreground mb-3 text-xs font-semibold">{monthLabel}</p>
      <div className="grid grid-cols-7 gap-y-1 text-center">
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
          <span key={d} className="text-muted-foreground pb-1 text-[10px] font-semibold">
            {d}
          </span>
        ))}
        {Array.from({ length: blanks }, (_, i) => (
          <span key={`b${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const isToday = day === today.getDate();
          const dotClass = dayDotMap.get(day);
          return (
            <span
              key={day}
              className={`relative mx-auto flex size-7 items-center justify-center rounded-full text-xs font-medium ${
                isToday
                  ? 'bg-primary text-primary-foreground font-bold'
                  : 'hover:bg-muted cursor-default'
              }`}
            >
              {day}
              {dotClass && !isToday && (
                <span className={`${dotClass} absolute bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full`} />
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ─── meetup cover card ─────────────────────────────────────────── */

function MeetupCoverCard({ t, viewerId }: { t: TableDto; viewerId?: string | null }) {
  const filled = t.seats - t.seatsLeft;
  const cta = tableCta(t, viewerId);
  return (
    <Link
      href={`/tables/${t.id}`}
      className="bg-card shadow-soft ring-border/60 group block overflow-hidden rounded-3xl ring-1 transition-all hover:-translate-y-0.5 hover:shadow-glow"
    >
      <div className="relative h-36">
        <Cover
          src={t.imageUrl ?? undefined}
          category={t.category}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
        {/* day badge */}
        <span className="glass absolute left-3 top-3 rounded-full px-2 py-0.5 text-xs font-semibold text-white ring-1 ring-white/20">
          {dayLabel(t.startAt)}
        </span>
      </div>
      <div className="p-4">
        <CategoryPills category={t.category} variant="muted" max={3} className="mb-0.5" />
        <h3 className="font-heading truncate text-sm font-bold tracking-tight">
          {t.title ?? t.category}
        </h3>
        <p className="text-muted-foreground mt-0.5 truncate text-xs">
          <i className="fa-solid fa-location-dot mr-1" />
          {t.venueName ?? t.cafe?.name ?? 'See map'}
        </p>
        {/* avatar stack */}
        <div className="mt-2 flex items-center gap-2">
          <Avatar name={t.host?.username ?? 'member'} size={22} />
          <span className="text-muted-foreground text-xs">+{filled}</span>
        </div>
        <p className="text-muted-foreground mt-1 text-xs">
          <i className="fa-solid fa-calendar-day mr-1" />
          {formatDateTime(t.startAt)}
        </p>
        <p className="text-muted-foreground text-xs">
          <i className="fa-solid fa-chair mr-1" />
          {t.seatsLeft} seats left
        </p>
        <div className="mt-3 flex items-center justify-between">
          <span className="font-heading text-primary text-sm font-extrabold">
            {t.pricePKR == null ? 'Free' : formatPKR(t.pricePKR)}
          </span>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-[filter] group-hover:brightness-110 ${
              cta.primary ? 'bg-primary text-primary-foreground' : 'bg-secondary text-primary'
            }`}
          >
            {cta.label}
          </span>
        </div>
      </div>
    </Link>
  );
}

/* ─── my meetups table row ──────────────────────────────────────── */

function formatMeetupDateCompact(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short' }),
    time: d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }),
  };
}

function MeetupTableRow({
  t,
  meId,
  coords,
}: {
  t: TableDto;
  meId?: string;
  coords: { lat: number; lng: number } | null;
}) {
  const router = useRouter();
  const hosting = meId != null && t.hostId === meId;
  const approved = t.myRequestStatus === 'APPROVED';
  const tLat = t.lat ?? t.cafe?.lat ?? null;
  const tLng = t.lng ?? t.cafe?.lng ?? null;
  const distLabel =
    coords !== null && tLat !== null && tLng !== null
      ? formatDistance(haversineKm(coords.lat, coords.lng, tLat, tLng))
      : '—';

  function openTable() {
    router.push(`/tables/${t.id}`);
  }

  return (
    <tr
      role="link"
      tabIndex={0}
      onClick={openTable}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openTable();
        }
      }}
      className="border-border/60 hover:bg-muted/60 cursor-pointer border-b last:border-0 transition-colors"
      aria-label={`Open ${t.title ?? t.category}`}
    >
      <td className="py-3 pr-4">
        <div className="flex items-center gap-3">
          <div className="ring-border/40 h-10 w-10 shrink-0 overflow-hidden rounded-xl ring-1">
            <Cover src={t.imageUrl ?? undefined} category={t.category} className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0">
            <p className="font-heading truncate text-sm font-bold">
              {t.title ?? t.category}
            </p>
            <p className="text-muted-foreground truncate text-xs">
              {t.venueName ?? t.cafe?.name ?? 'See map'}
            </p>
          </div>
        </div>
      </td>
      <td className="text-muted-foreground py-3 pr-4 text-xs whitespace-nowrap">
        {formatDateTime(t.startAt)}
      </td>
      <td className="text-muted-foreground py-3 pr-4 text-xs whitespace-nowrap">
        {t.venueName ?? t.cafe?.name ?? '—'}
      </td>
      <td className="text-muted-foreground py-3 pr-4 text-xs whitespace-nowrap">
        {distLabel}
      </td>
      <td className="py-3 pr-4">
        <Badge variant={hosting ? 'secondary' : approved ? 'success' : 'warning'}>
          {hosting ? 'Hosting' : approved ? 'Confirmed' : 'Pending'}
        </Badge>
      </td>
      <td className="py-3 text-right">
        <i className="fa-solid fa-chevron-right text-muted-foreground text-xs" aria-hidden />
      </td>
    </tr>
  );
}

function MeetupMobileRow({ t }: { t: TableDto }) {
  const router = useRouter();
  const { date, time } = formatMeetupDateCompact(t.startAt);

  function openTable() {
    router.push(`/tables/${t.id}`);
  }

  return (
    <button
      type="button"
      onClick={openTable}
      className="hover:bg-muted/60 flex w-full items-center gap-1 border-b border-border/60 px-1 py-3 text-left last:border-0 transition-colors"
      aria-label={`Open ${t.title ?? t.category}`}
    >
      <div className="ring-border/40 h-10 w-10 shrink-0 overflow-hidden rounded-xl ring-1">
        <Cover src={t.imageUrl ?? undefined} category={t.category} className="h-full w-full object-cover" />
      </div>
      <div className="min-w-0 max-w-[58%] flex-1">
        <p className="font-heading truncate text-sm font-bold">{t.title ?? t.category}</p>
        <p className="text-muted-foreground truncate text-xs">
          {t.venueName ?? t.cafe?.name ?? 'See map'}
        </p>
      </div>
      <div className="text-muted-foreground ml-1 shrink-0 text-right text-[11px] leading-snug">
        <p className="whitespace-nowrap">{date}</p>
        <p className="whitespace-nowrap">{time}</p>
      </div>
    </button>
  );
}

function MeetupTable({
  rows,
  emptyMsg,
  meId,
  coords,
}: {
  rows: TableDto[];
  emptyMsg: string;
  meId?: string;
  coords: { lat: number; lng: number } | null;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed py-10 text-center">
        <p className="text-muted-foreground text-sm">{emptyMsg}</p>
      </div>
    );
  }
  return (
    <div className="bg-card shadow-soft rounded-3xl border p-4 sm:p-5">
      {/* Mobile: compact two-zone rows (no table overflow) */}
      <div className="md:hidden">
        {rows.map((t) => (
          <MeetupMobileRow key={t.id} t={t} />
        ))}
      </div>

      {/* Desktop: full table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full">
          <thead>
            <tr className="border-border/60 border-b">
              {['Meetup', 'Date & Time', 'Location', 'Distance', 'Status', ''].map((h) => (
                <th
                  key={h || 'go'}
                  className="text-muted-foreground pb-2 pr-4 text-left text-xs font-semibold last:pr-0"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <MeetupTableRow key={t.id} t={t} meId={meId} coords={coords} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── suggested row ─────────────────────────────────────────────── */

function SuggestedRow({ t }: { t: TableDto }) {
  return (
    <Link
      href={`/tables/${t.id}`}
      className="hover:bg-muted -mx-2 flex items-center gap-3 rounded-2xl px-2 py-2 transition-colors"
    >
      <div className="ring-border/40 h-14 w-14 shrink-0 overflow-hidden rounded-xl ring-1">
        <Cover src={t.imageUrl ?? undefined} category={t.category} className="h-full w-full object-cover" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-heading truncate text-sm font-bold">
          {t.title ?? t.category}
        </p>
        <p className="text-muted-foreground truncate text-xs">
          <i className="fa-solid fa-location-dot mr-1" />
          {t.venueName ?? t.cafe?.name ?? 'See map'}
        </p>
        <p className="text-muted-foreground truncate text-xs">{formatDateTime(t.startAt)}</p>
        <p className="font-heading text-primary text-xs font-bold">
          {t.pricePKR == null ? 'Free' : formatPKR(t.pricePKR)}
        </p>
      </div>
    </Link>
  );
}

/* ─── skeleton card ─────────────────────────────────────────────── */

function SkeletonCard() {
  return (
    <div className="bg-card shadow-soft ring-border/60 animate-pulse overflow-hidden rounded-3xl ring-1">
      <div className="bg-muted h-36 w-full" />
      <div className="p-4 space-y-2">
        <div className="bg-muted h-3 w-1/3 rounded-full" />
        <div className="bg-muted h-4 w-2/3 rounded-full" />
        <div className="bg-muted h-3 w-1/2 rounded-full" />
        <div className="mt-3 bg-muted h-4 w-1/4 rounded-full" />
      </div>
    </div>
  );
}

function SkeletonTableRow() {
  return (
    <div className="animate-pulse flex items-center gap-4 py-3">
      <div className="bg-muted h-10 w-10 shrink-0 rounded-xl" />
      <div className="flex-1 space-y-2">
        <div className="bg-muted h-3 w-1/3 rounded-full" />
        <div className="bg-muted h-3 w-1/4 rounded-full" />
      </div>
      <div className="bg-muted h-3 w-20 rounded-full" />
      <div className="bg-muted h-3 w-16 rounded-full" />
      <div className="bg-muted h-5 w-16 rounded-full" />
      <div className="bg-muted h-7 w-16 rounded-full" />
    </div>
  );
}

/* ─── filters panel (desktop aside + mobile drawer) ─────────────── */

type MeetupsFiltersPanelProps = {
  when: WhenFilter;
  setWhen: Dispatch<SetStateAction<WhenFilter>>;
  fromDate: string;
  setFromDate: Dispatch<SetStateAction<string>>;
  toDate: string;
  setToDate: Dispatch<SetStateAction<string>>;
  category: string;
  setCategory: Dispatch<SetStateAction<string>>;
  categories: string[];
  showAllCats: boolean;
  setShowAllCats: Dispatch<SetStateAction<boolean>>;
  radiusKm: number;
  setRadiusKm: Dispatch<SetStateAction<number>>;
  clearFilters: () => void;
  /** Mobile drawer: close after Apply */
  onApply?: () => void;
};

function MeetupsFiltersPanel({
  when,
  setWhen,
  fromDate,
  setFromDate,
  toDate,
  setToDate,
  category,
  setCategory,
  categories,
  showAllCats,
  setShowAllCats,
  radiusKm,
  setRadiusKm,
  clearFilters,
  onApply,
}: MeetupsFiltersPanelProps) {
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

      {/* WHEN */}
      <div className="mb-5">
        <p className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-wide">
          When
        </p>
        <ul className="space-y-1">
          {(
            [
              { id: 'all', label: 'All Meetups' },
              { id: 'upcoming', label: 'Upcoming' },
              { id: 'week', label: 'This Week' },
              { id: 'weekend', label: 'This Weekend' },
              { id: 'past', label: 'Past' },
            ] as { id: WhenFilter; label: string }[]
          ).map((opt) => (
            <li key={opt.id}>
              <button
                type="button"
                onClick={() => setWhen(opt.id)}
                className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors ${
                  when === opt.id
                    ? 'bg-primary/10 text-primary font-semibold'
                    : 'hover:bg-muted text-foreground'
                }`}
              >
                <span
                  className={`inline-block size-3.5 rounded-full border-2 ${
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
      </div>

      {/* DATE RANGE */}
      <div className="mb-5">
        <p className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-wide">
          Date Range
        </p>
        <div className="space-y-2">
          <div>
            <label className="text-muted-foreground block text-xs font-medium">From</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="border-border focus:ring-primary mt-1 w-full rounded-xl border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2"
            />
          </div>
          <div>
            <label className="text-muted-foreground block text-xs font-medium">To</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="border-border focus:ring-primary mt-1 w-full rounded-xl border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2"
            />
          </div>
        </div>
      </div>

      {/* CATEGORY */}
      <div className="mb-5">
        <p className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-wide">
          Category
        </p>
        <ul className="space-y-1">
          <li>
            <button
              type="button"
              onClick={() => setCategory('')}
              className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors ${
                category === ''
                  ? 'bg-secondary text-primary font-semibold'
                  : 'hover:bg-muted text-foreground'
              }`}
            >
              <i className="fa-solid fa-table-cells-large w-4 text-center" />
              All Categories
            </button>
          </li>
          {(showAllCats ? categories : categories.slice(0, 6)).map((cat) => (
            <li key={cat}>
              <button
                type="button"
                onClick={() => setCategory(cat)}
                className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors ${
                  category === cat
                    ? 'bg-secondary text-primary font-semibold'
                    : 'hover:bg-muted text-foreground'
                }`}
              >
                <i className={`fa-solid ${categoryIcon(cat)} w-4 text-center`} />
                {cat}
              </button>
            </li>
          ))}
        </ul>
        {categories.length > 6 && (
          <button
            type="button"
            onClick={() => setShowAllCats((s) => !s)}
            className="text-primary mt-2 pl-3 text-xs font-semibold hover:underline"
          >
            {showAllCats ? 'View less' : `View more (${categories.length - 6})`}
          </button>
        )}
      </div>

      {/* LOCATION */}
      <div className="mb-5">
        <p className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-wide">
          Location
        </p>
        <input
          type="text"
          placeholder="Search area…"
          className="border-border focus:ring-primary w-full rounded-xl border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2"
        />
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Distance</span>
            <span className="font-semibold">
              {radiusKm >= 50 ? '50+ km' : `${radiusKm} km`}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={50}
            value={radiusKm}
            onChange={(e) => setRadiusKm(Number(e.target.value))}
            className="accent-primary w-full"
          />
          <div className="text-muted-foreground mt-0.5 flex justify-between text-[10px]">
            <span>0 km</span>
            <span>50+ km</span>
          </div>
        </div>
      </div>

      {/* Apply — filters are live; on mobile this closes the drawer */}
      <button
        type="button"
        onClick={() => onApply?.()}
        className="bg-primary text-primary-foreground hover:brightness-110 w-full rounded-full py-2.5 text-sm font-semibold transition-[filter]"
      >
        Apply Filters
      </button>
    </>
  );
}

/* ─── right rail (desktop aside + mobile drawer) ────────────────── */

type MeetupsRailPanelProps = {
  joinedView: TableDto[];
  browseView: TableDto[];
  invitesView: InviteDto[];
  inviteBusy: string | null;
  handleInviteAction: (id: string, action: 'accept' | 'maybe') => void;
  user: PublicUser | null;
};

function MeetupsRailPanel({
  joinedView,
  browseView,
  invitesView,
  inviteBusy,
  handleInviteAction,
  user,
}: MeetupsRailPanelProps) {
  return (
    <div className="space-y-4">
      <CalendarCard joined={joinedView} />

      <div className="bg-card shadow-soft rounded-3xl border p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="font-heading font-bold tracking-tight">Suggested for you</p>
          <Link href="/discover" className="text-primary text-xs font-semibold hover:underline">
            See all
          </Link>
        </div>
        {browseView.slice(0, 3).length === 0 ? (
          <p className="text-muted-foreground text-sm">No suggestions right now.</p>
        ) : (
          <div className="space-y-1">
            {browseView.slice(0, 3).map((t) => (
              <SuggestedRow key={t.id} t={t} />
            ))}
          </div>
        )}
      </div>

      <div className="bg-card shadow-soft rounded-3xl border p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="font-heading font-bold tracking-tight">Your invitations</p>
          <Link href="/invites" className="text-primary text-xs font-semibold hover:underline">
            View all
          </Link>
        </div>
        {invitesView.length === 0 ? (
          <div className="rounded-2xl border border-dashed py-6 text-center">
            <p className="text-muted-foreground text-sm">No invitations yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {invitesView.slice(0, 2).map((inv) => (
              <div key={inv.id} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="ring-border/40 h-9 w-9 shrink-0 overflow-hidden rounded-xl ring-1">
                    <Cover category={inv.table.category} className="h-full w-full object-cover" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/tables/${inv.table.id}`}
                      className="font-heading block truncate text-xs font-bold hover:underline"
                    >
                      {inv.table.title ?? inv.table.category}
                    </Link>
                    <div className="flex items-center gap-1">
                      <Avatar name={personName(inv.inviter)} size={14} />
                      <span className="text-muted-foreground truncate text-[11px]">
                        {personName(inv.inviter)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <Button
                    size="xs"
                    disabled={inviteBusy === inv.id}
                    onClick={() => void handleInviteAction(inv.id, 'accept')}
                    className="flex-1 text-[11px]"
                  >
                    {inviteBusy === inv.id ? '…' : 'Accept'}
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={inviteBusy === inv.id}
                    onClick={() => void handleInviteAction(inv.id, 'maybe')}
                    className="text-[11px]"
                  >
                    Maybe
                  </Button>
                </div>
              </div>
            ))}
            {invitesView.length > 2 && (
              <Link
                href="/invites"
                className="text-primary block pt-1 text-center text-xs font-semibold hover:underline"
              >
                +{invitesView.length - 2} more →
              </Link>
            )}
          </div>
        )}
      </div>

      {user?.canHost === true && (
        <div className="bg-secondary rounded-3xl p-5">
          <div className="mb-3 text-center text-4xl">
            <i className="fa-solid fa-mug-hot text-primary" />
          </div>
          <p className="font-heading text-secondary-foreground text-center font-bold tracking-tight">
            Host your own meetup
          </p>
          <p className="text-secondary-foreground/80 mt-2 text-center text-sm">
            Bring people together for good conversations in person.
          </p>
          <Link
            href="/tables/new"
            className="bg-primary text-primary-foreground hover:brightness-110 mt-4 block rounded-full py-2.5 text-center text-sm font-semibold transition-[filter]"
          >
            Create Meetup
          </Link>
        </div>
      )}
    </div>
  );
}

/* ─── tabs ──────────────────────────────────────────────────────── */

// TABS is derived inside the component to get the live invite count.

/* ─── main page ─────────────────────────────────────────────────── */

export default function MeetupsPage() {
  const { user, loading } = useAuth();

  const [browse, setBrowse] = useState<TableDto[]>([]);
  const [joined, setJoined] = useState<TableDto[]>([]);
  const [hosted, setHosted] = useState<TableDto[]>([]);
  const [invites, setInvites] = useState<InviteDto[]>([]);
  const [inviteBusy, setInviteBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listsLoading, setListsLoading] = useState(true);

  // Sync seed from cache during render (no effect setState) so revisits paint instantly.
  const seedKeys = tablesCacheKeys(user?.id);
  const seedBrowse = peekCache<TableDto[]>(seedKeys.browse);
  const seedJoined = peekCache<TableDto[]>(seedKeys.joined);
  const seedHosted = peekCache<TableDto[]>(seedKeys.hosted);
  const seedInvites = peekCache<InviteDto[]>(seedKeys.invites);
  const browseView = browse.length > 0 ? browse : (seedBrowse ?? []);
  const joinedView = joined.length > 0 ? joined : (seedJoined ?? []);
  const hostedView = hosted.length > 0 ? hosted : (seedHosted ?? []);
  const invitesView = invites.length > 0 ? invites : (seedInvites ?? []);
  const listsPending =
    listsLoading && browseView.length === 0 && joinedView.length === 0 && hostedView.length === 0;

  // filters
  const [when, setWhen] = useState<WhenFilter>('upcoming');
  const [category, setCategory] = useState('');
  const [showAllCats, setShowAllCats] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [radiusKm, setRadiusKm] = useState(50);

  // geolocation
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  // tabs
  const [tab, setTab] = useState<TabId>('upcoming');
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [railDrawerOpen, setRailDrawerOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const keys = tablesCacheKeys(user.id);

    void (async () => {
      try {
        const [b, j, h] = await Promise.all([
          swrGet(keys.browse, () => api.browseTables()),
          swrGet(keys.joined, () => api.myJoinedTables()),
          swrGet(keys.hosted, () => api.myHostedTables()).catch(
            () => [] as TableDto[],
          ),
        ]);
        if (active) {
          setBrowse(b);
          setJoined(j);
          setHosted(h);
        }
      } catch (err) {
        if (active) setError(err instanceof ApiError ? err.message : 'Failed to load meetups');
      } finally {
        if (active) setListsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const keys = tablesCacheKeys(user.id);
    void (async () => {
      try {
        const data = await swrGet(keys.invites, () => api.myInvites());
        if (active) setInvites(data);
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (p) => setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {},
      { timeout: 8000 },
    );
  }, []);

  const categories = useMemo(
    () =>
      [...new Set([...browseView, ...joinedView].flatMap((t) => splitCategories(t.category)))].sort(),
    [browseView, joinedView],
  );

  // filtered subsets
  const filteredBrowse = useMemo(
    () => applyFilters(browseView, when, category, fromDate, toDate, coords, radiusKm),
    [browseView, when, category, fromDate, toDate, coords, radiusKm],
  );

  // Cover grid respects When. For non-past presets, keep only future starts so
  // "All Meetups" still reads as an upcoming discovery strip.
  const upcomingCards = useMemo(() => {
    const rows =
      when === 'past'
        ? filteredBrowse
        : filteredBrowse.filter((t) => new Date(t.startAt).getTime() >= NOW);
    return rows.slice(0, 3);
  }, [filteredBrowse, when]);

  // "My Meetups" = tables I host + tables I've joined (approved/pending), deduped.
  // Stay visible until the table is closed (CANCELLED / COMPLETED) — not when
  // startAt passes. Time "when" filters are not applied here (use 'all').
  const activeJoined = useMemo(() => {
    const mine = [
      ...hostedView,
      ...joinedView.filter(
        (t) => t.myRequestStatus === 'APPROVED' || t.myRequestStatus === 'PENDING',
      ),
    ];
    const seen = new Set<string>();
    const deduped = mine.filter((t) => (seen.has(t.id) ? false : seen.add(t.id)));
    const live = deduped.filter(
      (t) => t.status !== 'CANCELLED' && t.status !== 'COMPLETED',
    );
    return applyFilters(live, 'all', category, fromDate, toDate, coords, radiusKm);
  }, [hostedView, joinedView, category, fromDate, toDate, coords, radiusKm]);

  // Past tab — closed meetups I hosted or joined (not cancelled).
  const pastJoined = useMemo(() => {
    const mine = [
      ...hostedView.filter((t) => t.status === 'COMPLETED'),
      ...joinedView.filter(
        (t) =>
          t.status === 'COMPLETED' &&
          (t.myRequestStatus === 'APPROVED' || t.myRequestStatus === 'PENDING'),
      ),
    ];
    const seen = new Set<string>();
    return mine.filter((t) => (seen.has(t.id) ? false : seen.add(t.id)));
  }, [hostedView, joinedView]);

  if (!loading && !user)
    return (
      <main className="p-6 text-sm">
        Please{' '}
        <Link href="/login" className="underline">
          sign in
        </Link>{' '}
        first.
      </main>
    );

  const TABS: { id: TabId; label: string; badge?: number }[] = [
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'my', label: 'My Meetups' },
    { id: 'invitations', label: 'Invitations', badge: invitesView.length },
    { id: 'past', label: 'Past' },
    { id: 'saved', label: 'Saved' },
  ];

  function clearFilters() {
    setWhen('all');
    setCategory('');
    setFromDate('');
    setToDate('');
    setRadiusKm(50);
  }

  async function handleInviteAction(
    id: string,
    action: 'accept' | 'maybe',
  ) {
    setInviteBusy(id);
    try {
      if (action === 'accept') await api.acceptInvite(id);
      else await api.maybeInvite(id);
      invalidateTablesClientCache();
      setInvites((prev) => prev.filter((inv) => inv.id !== id));
    } catch {
      /* best-effort */
    } finally {
      setInviteBusy(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-[1508px] flex-1 px-4 py-6 sm:px-6">
      {error && (
        <p className="text-destructive mb-4 text-sm">{error}</p>
      )}

      <div className="grid gap-6 lg:grid-cols-[240px_1fr_320px]">
        {/* ── LEFT RAIL (desktop) ────────────────────────────────── */}
        <aside className="bg-card shadow-soft hidden rounded-3xl border p-5 lg:sticky lg:top-24 lg:block lg:self-start">
          <div className="mb-4 flex items-center justify-between gap-2">
            <p className="font-heading font-bold tracking-tight">Filters</p>
            <button
              type="button"
              onClick={clearFilters}
              className="text-primary text-xs font-semibold hover:underline"
            >
              Clear all
            </button>
          </div>
          <MeetupsFiltersPanel
            when={when}
            setWhen={setWhen}
            fromDate={fromDate}
            setFromDate={setFromDate}
            toDate={toDate}
            setToDate={setToDate}
            category={category}
            setCategory={setCategory}
            categories={categories}
            showAllCats={showAllCats}
            setShowAllCats={setShowAllCats}
            radiusKm={radiusKm}
            setRadiusKm={setRadiusKm}
            clearFilters={clearFilters}
          />
        </aside>

        {/* ── MAIN COLUMN ────────────────────────────────────────── */}
        <div className="min-w-0 space-y-6 lg:pt-5">
          {/* mobile toolbar */}
          <div className="flex gap-2 lg:hidden">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setFilterDrawerOpen(true)}
              className="flex-1"
            >
              <i className="fa-solid fa-sliders mr-2" />
              Filters
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRailDrawerOpen(true)}
              className="flex-1"
            >
              <i className="fa-solid fa-calendar-days mr-2" />
              More
            </Button>
          </div>

          {/* header */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div>
              <h1 className="display text-2xl font-extrabold tracking-tight sm:text-3xl">Meetups</h1>
              <p className="text-muted-foreground mt-1 text-sm">
                Discover, join and manage your meetups.
              </p>
            </div>
            {user?.canHost === true && (
              <Link
                href="/tables/new"
                className="bg-primary text-primary-foreground hover:brightness-110 hover:shadow-glow hover:-translate-y-0.5 w-full shrink-0 rounded-full px-5 py-2.5 text-center text-sm font-semibold shadow-soft transition-all sm:w-auto"
              >
                + Create Meetup
              </Link>
            )}
          </div>

          {/* tabs — Past & Saved desktop-only; equal-width tabs on mobile */}
          <div className="border-border/60 flex border-b lg:overflow-x-auto">
            {TABS.map(({ id, label, badge }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`-mb-px flex items-center justify-center gap-1 py-2.5 text-center text-sm font-semibold transition-colors ${
                  id === 'past' || id === 'saved'
                    ? 'hidden lg:inline-flex lg:shrink-0 lg:px-4'
                    : 'min-w-0 flex-1 px-1 lg:flex-none lg:shrink-0 lg:px-4'
                } ${
                  tab === id
                    ? 'text-primary border-primary border-b-2'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <span className="truncate">{label}</span>
                {badge !== undefined && (
                  <span className="bg-secondary text-secondary-foreground shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold">
                    {badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── UPCOMING TAB ─────────────────────────────────────── */}
          {tab === 'upcoming' && (
            <div className="space-y-8">
              {/* cover grid */}
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-heading text-lg font-bold tracking-tight">
                    {when === 'past' ? 'Past Meetups' : 'Upcoming Meetups'}
                  </h2>
                  <Link href="/discover" className="text-primary text-sm font-semibold hover:underline">
                    View all →
                  </Link>
                </div>
                {listsPending ? (
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {Array.from({ length: 3 }, (_, i) => <SkeletonCard key={i} />)}
                  </div>
                ) : upcomingCards.length === 0 ? (
                  <EmptyMascot
                    className="py-12"
                    quip={
                      when === 'past'
                        ? 'No past circles in this filter.'
                        : 'No meetups here yet…'
                    }
                    title={
                      when === 'past'
                        ? 'No past meetups match your filters'
                        : 'No upcoming meetups match your filters'
                    }
                    description="Try another When filter or clear filters."
                  />
                ) : (
                  <StaggerIn
                    className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
                    deps={[upcomingCards.map((t) => t.id).join(',')]}
                  >
                    {upcomingCards.map((t) => (
                      <MeetupCoverCard key={t.id} t={t} viewerId={user?.id} />
                    ))}
                  </StaggerIn>
                )}
              </section>

              {/* my meetups mini-table — desktop only; mobile uses My Meetups tab */}
              <section className="hidden lg:block">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-heading text-lg font-bold tracking-tight">My Meetups</h2>
                </div>
                {listsPending ? (
                  <div className="bg-card shadow-soft rounded-3xl border p-5 divide-y divide-border/60">
                    {Array.from({ length: 3 }, (_, i) => <SkeletonTableRow key={i} />)}
                  </div>
                ) : (
                  <>
                    <MeetupTable
                      rows={activeJoined}
                      emptyMsg="You aren't hosting or attending any meetups yet."
                      meId={user?.id}
                      coords={coords}
                    />
                    {activeJoined.length > 0 && (
                      <Link
                        href="/meetups"
                        className="text-primary mt-3 block text-sm font-semibold hover:underline"
                        onClick={() => setTab('my')}
                      >
                        View all my meetups →
                      </Link>
                    )}
                  </>
                )}
              </section>
            </div>
          )}

          {/* ── MY MEETUPS TAB ───────────────────────────────────── */}
          {tab === 'my' && (
            <div className="space-y-4">
              <h2 className="font-heading text-lg font-bold tracking-tight">My Meetups</h2>
              {listsPending ? (
                <div className="bg-card shadow-soft rounded-3xl border p-5 divide-y divide-border/60">
                  {Array.from({ length: 3 }, (_, i) => <SkeletonTableRow key={i} />)}
                </div>
              ) : (
                <MeetupTable
                  rows={activeJoined}
                  emptyMsg="You aren't hosting or attending any meetups yet."
                  meId={user?.id}
                  coords={coords}
                />
              )}
            </div>
          )}

          {/* ── INVITATIONS TAB ──────────────────────────────────── */}
          {tab === 'invitations' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-heading text-lg font-bold tracking-tight">Invitations</h2>
                <Link href="/invites" className="text-primary text-sm font-semibold hover:underline">
                  View all →
                </Link>
              </div>
              {invitesView.length === 0 ? (
                <EmptyMascot
                  className="py-16"
                  quip="Inbox’s quiet. That’s okay."
                  title="No invitations yet"
                  description="Invites to join meetups will show here."
                />
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {invitesView.map((inv) => (
                    <div key={inv.id} className="bg-card shadow-soft ring-border/60 overflow-hidden rounded-3xl ring-1">
                      <div className="relative h-32">
                        <Cover category={inv.table.category} className="h-full w-full object-cover" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                      </div>
                      <div className="p-4 space-y-2">
                        <CategoryPills
                          category={inv.table.category}
                          variant="muted"
                          max={3}
                        />
                        <Link
                          href={`/tables/${inv.table.id}`}
                          className="font-heading block truncate text-sm font-bold tracking-tight hover:underline"
                        >
                          {inv.table.title ?? inv.table.category}
                        </Link>
                        <p className="text-muted-foreground text-xs">
                          <i className="fa-solid fa-calendar-day mr-1" />
                          {formatDateTime(inv.table.startAt)}
                        </p>
                        <div className="flex items-center gap-1.5">
                          <Avatar name={personName(inv.inviter)} size={18} />
                          <span className="text-muted-foreground text-xs">
                            Invited by <span className="text-foreground font-semibold">{personName(inv.inviter)}</span>
                          </span>
                        </div>
                        <div className="flex gap-2 pt-1">
                          <Button
                            size="xs"
                            disabled={inviteBusy === inv.id}
                            onClick={() => void handleInviteAction(inv.id, 'accept')}
                            className="flex-1"
                          >
                            {inviteBusy === inv.id ? '…' : 'Accept'}
                          </Button>
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={inviteBusy === inv.id}
                            onClick={() => void handleInviteAction(inv.id, 'maybe')}
                          >
                            Maybe
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── PAST TAB ─────────────────────────────────────────── */}
          {tab === 'past' && (
            <div className="space-y-4">
              <h2 className="font-heading text-lg font-bold tracking-tight">Past Meetups</h2>
              <MeetupTable
                rows={pastJoined}
                emptyMsg="No past meetups yet."
                coords={coords}
              />
            </div>
          )}

          {/* ── SAVED TAB ────────────────────────────────────────── */}
          {tab === 'saved' && (
            <EmptyMascot
              className="py-16"
              quip="Bookmark a meetup you like."
              title="No saved meetups yet"
              description="Tap the heart on any meetup to save it here."
            />
          )}
        </div>

        {/* ── RIGHT RAIL (desktop) ───────────────────────────────── */}
        <aside className="hidden space-y-4 lg:sticky lg:top-24 lg:block lg:self-start">
          <MeetupsRailPanel
            joinedView={joinedView}
            browseView={browseView}
            invitesView={invitesView}
            inviteBusy={inviteBusy}
            handleInviteAction={handleInviteAction}
            user={user}
          />
        </aside>
      </div>

      <SideDrawer
        open={filterDrawerOpen}
        onClose={() => setFilterDrawerOpen(false)}
        side="left"
        title="Filters"
      >
        <MeetupsFiltersPanel
          when={when}
          setWhen={setWhen}
          fromDate={fromDate}
          setFromDate={setFromDate}
          toDate={toDate}
          setToDate={setToDate}
          category={category}
          setCategory={setCategory}
          categories={categories}
          showAllCats={showAllCats}
          setShowAllCats={setShowAllCats}
          radiusKm={radiusKm}
          setRadiusKm={setRadiusKm}
          clearFilters={clearFilters}
          onApply={() => setFilterDrawerOpen(false)}
        />
      </SideDrawer>

      <SideDrawer
        open={railDrawerOpen}
        onClose={() => setRailDrawerOpen(false)}
        side="right"
        title="Calendar & more"
      >
        <MeetupsRailPanel
          joinedView={joinedView}
          browseView={browseView}
          invitesView={invitesView}
          inviteBusy={inviteBusy}
          handleInviteAction={handleInviteAction}
          user={user}
        />
      </SideDrawer>
    </main>
  );
}
