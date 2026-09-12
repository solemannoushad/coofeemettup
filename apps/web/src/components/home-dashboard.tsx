'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  type FeaturedImageDto,
  type NotificationDto,
  type PublicUser,
  type TableDto,
} from '@jrst/api-client';
import { api } from '@/lib/api';
import { peekCache, swrGet, tablesCacheKeys } from '@/lib/data-cache';
import { formatDateTime, formatPKR } from '@/lib/format';
import { Cover } from '@/components/cover-image';
import { Avatar } from '@/components/avatar';
import { Badge } from '@/components/ui/badge';
import { categoryIcon, splitCategories } from '@/lib/category-icon';
import { CategoryPills } from '@/components/category-pills';
import { FeaturedShowcase } from '@/components/featured-showcase';
import { tableCta } from '@/lib/table-cta';
import { upcomingDiscoverTables } from '@/lib/table-time';
import { FadeIn } from '@/components/fade-in';
import { StaggerIn } from '@/components/stagger-in';

const initial = (s?: string | null) => (s ?? '?').charAt(0).toUpperCase();

function ago(iso: string, now: number) {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Content dashboard — Design System v2.0 home (desktop + mobile). */
export function HomeDashboard({ user }: { user: PublicUser }) {
  const keys = tablesCacheKeys(user.id);
  const [tables, setTables] = useState(
    () => peekCache<TableDto[]>(keys.browse) ?? [],
  );
  const [joined, setJoined] = useState(
    () => peekCache<TableDto[]>(keys.joined) ?? [],
  );
  const [hosted, setHosted] = useState(
    () => peekCache<TableDto[]>(keys.hosted) ?? [],
  );
  const [activity, setActivity] = useState<NotificationDto[]>([]);
  const [featured, setFeatured] = useState<FeaturedImageDto[]>([]);
  // Only block UI when we have nothing cached to paint.
  const [busy, setBusy] = useState(() => peekCache(keys.browse) == null);

  useEffect(() => {
    let active = true;
    const k = tablesCacheKeys(user.id);
    void (async () => {
      try {
        // Lists first — cache hits resolve immediately and clear the spinner.
        const [t, j, h] = await Promise.all([
          swrGet(k.browse, () => api.browseTables()),
          swrGet(k.joined, () => api.myJoinedTables()),
          swrGet(k.hosted, () => api.myHostedTables()).catch(
            () => [] as TableDto[],
          ),
        ]);
        if (!active) return;
        setTables(t);
        setJoined(j);
        setHosted(h);
        setBusy(false);

        // Side rails: never block the main dashboard on these.
        const [n, f] = await Promise.all([
          api
            .notifications()
            .catch(() => ({ items: [] as NotificationDto[], unread: 0 })),
          api.featuredImages().catch(() => [] as FeaturedImageDto[]),
        ]);
        if (!active) return;
        setActivity(n.items.slice(0, 3));
        setFeatured(f);
      } catch {
        if (active) setBusy(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [user.id]);

  const viewerId = user.id;
  const discoverable = upcomingDiscoverTables(tables);
  const upcoming = discoverable.slice(0, 6);
  const verified = user.verificationStatus === 'VERIFIED';
  const vibes = [...new Set(discoverable.flatMap((t) => splitCategories(t.category)))].slice(0, 6);
  const name = user.firstName ?? 'there';

  // eslint-disable-next-line react-hooks/purity -- one-time clock read for greeting + relative timestamps
  const now = Date.now();
  const hour = new Date(now).getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  // Next meetup = the soonest UPCOMING table the user is part of — one they host
  // OR joined (approved/pending) — sorted by start time.
  const next =
    [
      ...hosted,
      ...joined.filter(
        (t) => t.myRequestStatus === 'APPROVED' || t.myRequestStatus === 'PENDING',
      ),
    ]
      .filter((t) => new Date(t.startAt).getTime() >= now)
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())[0] ?? null;

  const needsName = !user.firstName || !user.lastName;

  return (
    <div className="space-y-5 md:space-y-6">
      {needsName && (
        <Link
          href="/profile?section=edit"
          className="border-primary/40 bg-secondary text-secondary-foreground flex flex-col gap-2 rounded-2xl border px-4 py-3 text-sm font-medium shadow-soft transition-[filter] hover:brightness-[0.98] sm:flex-row sm:items-center sm:gap-3"
        >
          <span className="flex flex-1 items-start gap-3">
            <i className="fa-solid fa-id-card text-primary mt-0.5" />
            <span>
              Finish your profile — add your name so hosts can prep for your visit. Your name
              stays private; only your @handle is public.
            </span>
          </span>
          <span className="text-primary font-semibold whitespace-nowrap sm:ml-0">Add name →</span>
        </Link>
      )}

      <div className="grid gap-5 md:gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      {/* ---------- main column ---------- */}
      <div className="min-w-0 space-y-5 md:space-y-6">
        {/* hero band — café illustration from the design, full-bleed on the right */}
        <FadeIn>
        <section className="bg-ink relative overflow-hidden rounded-3xl shadow-glow">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            {/* eslint-disable-next-line @next/next/no-img-element -- static bundled hero art */}
            <img
              src="/hero-cafe.jpg"
              alt=""
              className="ml-auto hidden h-full w-3/5 object-cover sm:block sm:w-1/2"
            />
            <div className="from-ink via-ink/85 to-ink/10 absolute inset-0 bg-gradient-to-r via-45% max-sm:via-ink/95" />
          </div>
          <div className="relative p-5 sm:p-8">
            <div className="max-w-md">
              <p className="text-sm font-medium text-white/70">{greeting}</p>
              <h1 className="font-heading mt-1 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
                {name}
              </h1>
              <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/70 sm:text-base">
                Find meaningful conversations with people near you.
              </p>
              <div className="mt-5 flex flex-wrap gap-2.5 sm:mt-6 sm:gap-3">
                <Link
                  href="/tables/nearby"
                  className="text-ink rounded-full bg-white px-4 py-2 text-sm font-bold transition-transform hover:-translate-y-0.5 sm:px-5 sm:py-2.5"
                >
                  Find a meetup →
                </Link>
                <Link
                  href="/discover"
                  className="rounded-full px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/30 backdrop-blur transition-colors hover:bg-white/10 sm:px-5 sm:py-2.5"
                >
                  Explore meetups
                </Link>
              </div>
            </div>
            {/* stats row */}
            <div className="mt-5 flex flex-col gap-3 border-t border-white/10 pt-4 sm:mt-7 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-10 sm:gap-y-3 sm:pt-5">
              <HeroStat icon="fa-location-dot" value={String(discoverable.length)} label="Meetups nearby" />
              <HeroStat
                icon="fa-calendar-day"
                value={next ? next.title ?? next.category : 'None yet'}
                label={next ? formatDateTime(next.startAt) : 'Next meetup'}
                href={next ? `/tables/${next.id}` : undefined}
                truncate
              />
              <HeroStat icon="fa-star" value={String(user.reliabilityScore)} label="Reliability score" />
            </div>
          </div>
        </section>
        </FadeIn>

        {/* featured moments — photos, reels, collages */}
        {featured.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <span className="bg-gradient-ember grid size-7 place-items-center rounded-xl text-white">
                    <i className="fa-solid fa-clapperboard text-xs" />
                  </span>
                  <p className="eyebrow text-primary mb-0">Moments</p>
                </div>
                <h2 className="font-heading text-xl font-bold tracking-tight">
                  Featured from meetups
                </h2>
                <p className="text-muted-foreground text-sm">
                  Photos, reels, and collages curated from real meetups.
                </p>
              </div>
            </div>
            <FeaturedShowcase slides={featured} />
          </section>
        )}

        {/* popular vibes */}
        {busy ? (
          <div>
            <p className="font-heading mb-2 text-sm font-bold">Popular vibes</p>
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <span key={i} className="bg-muted h-8 w-24 animate-pulse rounded-full" />
              ))}
            </div>
          </div>
        ) : (
          vibes.length > 0 && (
          <div>
            <p className="font-heading mb-2 text-sm font-bold">Popular vibes</p>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
              {vibes.map((c, i) => (
                <Link
                  key={c}
                  href="/discover"
                  className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 transition-all hover:-translate-y-0.5 ${
                    i === 0
                      ? 'bg-primary text-primary-foreground ring-transparent'
                      : 'bg-card ring-border/60 hover:shadow-soft'
                  }`}
                >
                  <i className={`fa-solid ${categoryIcon(c)}`} /> {c}
                </Link>
              ))}
            </div>
          </div>
          )
        )}

        {/* tables near you */}
        <div>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-heading text-xl font-bold tracking-tight">Meetups near you</h2>
            <Link href="/discover" className="text-primary text-sm font-semibold hover:underline">
              See all →
            </Link>
          </div>
          {busy ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : upcoming.length === 0 ? (
            <div className="rounded-3xl border border-dashed py-12 text-center">
              <i className="fa-solid fa-chair text-3xl text-muted-foreground" />
              <p className="text-muted-foreground mt-2 text-sm">
                No open meetups right now — check{' '}
                <Link href="/discover" className="text-primary font-semibold hover:underline">
                  Discover
                </Link>
                .
              </p>
            </div>
          ) : (
            <StaggerIn
              className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
              deps={[upcoming.length, busy]}
            >
              {upcoming.map((t) => (
                <TableCoverCard key={t.id} t={t} viewerId={viewerId} />
              ))}
            </StaggerIn>
          )}
        </div>
      </div>

      {/* ---------- right rail (desktop only — mobile uses top/bottom nav) ---------- */}
      <aside className="scrollbar-hidden hidden space-y-4 lg:block lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-1">
        {/* profile card */}
        <div className="bg-card shadow-soft rounded-3xl border p-5">
          <div className="flex items-center gap-3">
            <Avatar name={name} src={user.photoUrl} size={56} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="font-heading truncate font-bold">{name}</p>
                {verified && <Badge variant="success">Verified ✓</Badge>}
              </div>
              <p className="text-muted-foreground text-sm">
                <i className="fa-solid fa-star text-amber-400" />{' '}
                <span className="text-foreground font-semibold">{user.reliabilityScore}</span>{' '}
                Reliability
              </p>
            </div>
          </div>
          <Link
            href="/profile"
            className="text-primary mt-3 inline-block text-sm font-semibold hover:underline"
          >
            View profile →
          </Link>
        </div>

        {/* upcoming meetup */}
        {next && (
          <div className="bg-card shadow-soft rounded-3xl border p-5">
            <p className="text-muted-foreground mb-2 text-sm font-semibold">Upcoming meetup</p>
            <Link
              href={`/tables/${next.id}`}
              className="hover:bg-muted -mx-2 flex items-center gap-3 rounded-2xl px-2 py-2 transition-colors"
            >
              <span className="bg-secondary text-primary grid size-11 shrink-0 place-items-center rounded-2xl text-lg">
                <i className={`fa-solid ${categoryIcon(next.category)}`} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-heading truncate font-bold tracking-tight">
                  {next.title ?? next.category}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {formatDateTime(next.startAt)}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  <i className="fa-solid fa-location-dot" /> {next.venueName ?? next.cafe?.name ?? 'See map'}
                </p>
              </div>
              <span className="text-muted-foreground">→</span>
            </Link>
          </div>
        )}

        {/* invite friends */}
        <div className="bg-secondary rounded-3xl p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-heading text-secondary-foreground font-bold tracking-tight">
                Invite friends
              </p>
              <p className="text-secondary-foreground/80 mt-1 text-sm">
                Better meetups with people you know.
              </p>
              <Link
                href="/invite"
                className="text-primary mt-3 inline-block text-sm font-bold hover:underline"
              >
                Invite now →
              </Link>
            </div>
            <i className="fa-solid fa-gift text-3xl text-primary" />
          </div>
        </div>

        {/* recent activity */}
        {activity.length > 0 && (
          <div className="bg-card shadow-soft rounded-3xl border p-5">
            <div className="mb-2 flex items-baseline justify-between">
              <p className="font-heading font-bold tracking-tight">Recent activity</p>
              <Link
                href="/notifications"
                className="text-primary text-xs font-semibold hover:underline"
              >
                View all
              </Link>
            </div>
            <ul className="space-y-3">
              {activity.map((n) => (
                <li key={n.id} className="flex items-start gap-3">
                  <span className="bg-primary/10 text-primary mt-0.5 grid size-8 shrink-0 place-items-center rounded-full text-sm">
                    <i className="fa-solid fa-bell" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{n.title}</p>
                    <p className="text-muted-foreground text-xs">{ago(n.createdAt, now)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* verify identity */}
        {!verified && (
          <div className="bg-card shadow-soft rounded-3xl border p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-heading font-bold tracking-tight">Verify your identity</p>
                <p className="text-muted-foreground mt-1 text-sm">
                  Verified members build trust and get into meetups faster.
                </p>
                <Link
                  href="/profile"
                  className="bg-primary text-primary-foreground mt-3 inline-block rounded-full px-4 py-2 text-sm font-semibold transition-transform hover:-translate-y-0.5"
                >
                  Verify now
                </Link>
              </div>
              <i className="fa-solid fa-shield-halved text-3xl text-primary" />
            </div>
          </div>
        )}
      </aside>
      </div>
    </div>
  );
}

function HeroStat({
  icon,
  value,
  label,
  truncate,
  href,
}: {
  icon: string;
  value: string;
  label: string;
  truncate?: boolean;
  href?: string;
}) {
  const inner = (
    <>
      <span className="glass-dark grid size-9 shrink-0 place-items-center rounded-xl text-base">
        <i className={`fa-solid ${icon}`} />
      </span>
      <div className="min-w-0">
        <p className={`font-heading text-sm font-bold ${truncate ? 'max-w-[11rem] truncate' : ''}`}>
          {value}
        </p>
        <p className="truncate text-xs text-white/60">{label}</p>
      </div>
    </>
  );
  return href ? (
    <Link
      href={href}
      className="-m-1 flex items-center gap-2.5 rounded-xl p-1 text-white transition-colors hover:bg-white/10"
    >
      {inner}
    </Link>
  ) : (
    <div className="flex items-center gap-2.5 text-white">{inner}</div>
  );
}

/** Loading placeholder matching TableCoverCard's shape. */
function SkeletonCard() {
  return (
    <div className="bg-card ring-border/60 overflow-hidden rounded-3xl ring-1">
      <div className="bg-muted h-40 w-full animate-pulse" />
      <div className="space-y-3 p-4">
        <div className="bg-muted h-4 w-2/3 animate-pulse rounded" />
        <div className="bg-muted h-3 w-1/2 animate-pulse rounded" />
        <div className="bg-muted h-3 w-1/3 animate-pulse rounded" />
        <div className="flex items-center justify-between pt-1">
          <div className="bg-muted h-5 w-20 animate-pulse rounded-full" />
          <div className="bg-muted h-4 w-12 animate-pulse rounded" />
        </div>
        <div className="bg-muted h-9 w-full animate-pulse rounded-full" />
      </div>
    </div>
  );
}

function TableCoverCard({ t, viewerId }: { t: TableDto; viewerId?: string | null }) {
  const low = t.seatsLeft > 0 && t.seatsLeft <= 2;
  const cta = tableCta(t, viewerId);
  return (
    <Link
      href={`/tables/${t.id}`}
      className="bg-card shadow-soft ring-border/60 group block overflow-hidden rounded-3xl ring-1 transition-all hover:-translate-y-0.5 hover:shadow-glow"
    >
      <div className="relative h-40">
        <Cover
          category={t.category}
          src={t.imageUrl ?? undefined}
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
        <h3 className="font-heading text-base font-bold tracking-tight">{t.title ?? t.category}</h3>
        <p className="text-muted-foreground mt-1 flex items-center gap-1 text-sm">
          <i className="fa-solid fa-calendar-day" /> {formatDateTime(t.startAt)}
        </p>
        <p className="text-muted-foreground mt-1 text-sm">
          <i className="fa-solid fa-location-dot" /> {t.venueName ?? t.cafe?.name ?? 'See map'}
        </p>
        <div className="text-muted-foreground mt-2 flex items-center gap-1.5 text-xs">
          <span className="bg-primary/10 text-primary grid size-6 place-items-center rounded-full text-[10px] font-bold">
            {initial(t.host?.username)}
          </span>
          Hosted by @{t.host?.username ?? 'member'}
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
            cta.primary
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-primary'
          }`}
        >
          {cta.label}
        </div>
      </div>
    </Link>
  );
}
