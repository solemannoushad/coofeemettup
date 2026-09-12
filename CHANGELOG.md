# Changelog

All notable UI/product changes are logged here.

## [Unreleased]

### 2026-09-12 — Live newsletter subscribe route

- Public subscribe is explicitly mounted at `POST /api/newsletter/subscribe` (`@Controller('newsletter')`) so the footer form hits a registered Nest route after API redeploy. Admin list stays at `GET /api/admin/newsletter/subscribers`.

### 2026-09-12 — Messages inbox cached across visits

- `/messages` seeds the conversation list (and last-opened thread) from the existing SWR cache, so client navigations skip the skeleton and refresh in the background. Cache is written on poll, send, and read; logout still clears it.

### 2026-09-12 — Chat: instant send, no page jump, no auto-open on mobile

- Messages and Table group chat send optimistically: the bubble appears immediately, the composer clears and stays enabled; the server copy replaces the placeholder, and on failure the bubble is removed and the text restored. Poll results are skipped while a send is in flight.
- Thread panes scroll themselves to the newest message (`scrollTo` on the pane) instead of `scrollIntoView`, so the page no longer jumps after sending. Pane heights account for the fixed nav so the pane, not the page, is the scroller on desktop and mobile.
- On small screens, `/messages` opens on the conversation list instead of auto-opening the most recent thread; desktop two-pane still pre-selects it.
- Message reactions toggle instantly (`toggleReactionLocally` in `lib/reactions.ts` mirrors the server toggle); the server summary reconciles afterwards and a failure reverts to the previous state.

### 2026-09-12 — Space below desktop nav

- App shell reserves 1.5rem of breathing room under the fixed desktop header (`md:pt-[5.75rem]`), so page content no longer sits flush against the navbar.

### 2026-09-12 — CI green: lint, prerender, Prisma generate

- Web: resolved React Compiler lint errors (no synchronous `setState` in effects, no ref reads during render) in loader, drawer, mobile top bar, tables map, device-location hook, and admin featured/newsletter pages using adjust-state-during-render or deferred callbacks. Behavior unchanged.
- Web: `hrefKey` is SSR-safe so `/login` and other public pages prerender under `next build`.
- API: `typecheck` runs `prisma generate` first (Prisma 7 no longer generates on install); lint `--fix` formatting applied.

### 2026-09-12 — Skeleton loading vs counter loader

- Page content loading uses layout skeletons (`ContentPlaceholder`, route-specific skeletons); the ink counter loader remains auth boot only (`AuthGate`).
- Counter loader locks document scroll and uses `scrollbar-gutter: stable` so the viewport width does not shift when content mounts under the overlay.
- `LoadingGate` mounts the app shell only after the counter settles at 100 (`PageLoader.onReady`), so the shell's render cost can no longer stall the ticker and make the count jump.

### 2026-09-12 — GSAP page transitions (OUTFIT / Framer wipe)

- In-app navigation uses a single ink wipe with light content fade/drift (~0.4s leave / ~0.48s enter). Respects reduced motion.
- Public/auth routes (login, legal) skip ink transitions; logo links on those pages navigate instantly.
- Page-level loading: counter tracks elapsed load time (caps ~88%), then always eases smoothly to 100 over a duration scaled to remaining progress before the ink wipe-off. Route transitions use longer `expo` easing (~0.72s leave / ~0.82s enter).

### 2026-09-12 — Footer scroll to top

- Site footer adds a Back to top button (smooth scroll, respects reduced motion).

### 2026-09-12 — Explore filters button on mobile

- Discover page mobile Filters control is inline width instead of full-bleed.

### 2026-09-12 — Home sidebar hidden on mobile

- Home right rail (profile, upcoming meetup, invite friends, activity) is desktop-only (`lg+`); mobile home shows the main feed without the stacked sidebar.

### 2026-09-12 — Mobile/desktop nav stickiness over footer

- Top and bottom nav chrome render at the app shell root with `fixed` positioning so they stay visible when scrolling through the footer; desktop nav no longer uses `sticky` (which unpinned at page bottom).

### 2026-09-12 — Footer social links

- Site footer social icons now link to Nine Circles Instagram, Facebook, and LinkedIn profiles (removed placeholder X/YouTube links).

### 2026-09-12 — Nearby map: English labels and filter sync

- Basemap labels prefer English/Latin script (`name:en`, `name:latin`) on Nearby, search preview, and venue picker maps.
- Nearby map pins now follow the same filters as the list (radius, category, status); empty results center on the user when location is available.
- Blue pulsing dot shows the user’s current location when geolocation is enabled (or after tapping locate on the map).
- Nearby geolocation uses high-accuracy live GPS (`watchPosition`), shows accuracy in the sidebar, and keeps the map centered on the user instead of zooming out to distant meetups nationwide.

### 2026-09-11 — Subtle GSAP motion across web

- Added reusable `FadeIn`, `PageEnter`, and improved `StaggerIn` primitives (respect reduced motion).
- Route transitions, login card steps, hero/marketing content, legal pages, and list grids (home, saved, requests, connections, search, invites) use light fade/stagger entrances; buttons get a soft tap scale.

### 2026-09-11 — Legal pages (Terms, Privacy, Community Guidelines)

- Replaced Terms of Service and Privacy Policy with the new 9 Circles legal drafts; added a public Community Guidelines page with cross-links in the footer and signed-out home hero.

### 2026-09-11 — Remember me on sign-in

- Login adds a “Remember me on this device” option (on by default): persistent sign-in stores the JWT in localStorage for up to 30 days; unchecked uses sessionStorage and a 1-day token.
- Saved email is prefilled when remember me was last enabled; network timeouts no longer clear a valid stored session.

### 2026-09-11 — Footer newsletter (API + admin)

- Footer subscribe saves emails to the database, sends a Nine Circles welcome email via the configured mail provider, and lists subscribers in Admin → Newsletter.

### 2026-09-11 — Mobile nav stickiness

- Bottom and top mobile chrome use fixed viewport positioning so tabs stay visible when scrolling through the footer.

### 2026-09-11 — Mobile account sidebar

- Avatar on small screens opens a right-side drawer with the full account menu (matching desktop), not a truncated popup.

### 2026-09-11 — Meetup-first site copy

- Replaced coffee-only and “table” marketing copy across web with broader in-person meetup language; updated site title/description and legal page titles to Nine Circles.

### 2026-09-11 — Site footer

- Added dark marketing footer app-wide (Explore + Legal menus, login-sized white logo, working social links, local newsletter signup, responsive mascot layout); hidden on login, chat, and admin.

### 2026-09-11 — Navbar logo size

- Desktop and mobile top nav wordmarks use a dedicated 70px nav size.

### 2026-09-11 — Upcoming tables only for discovery and join

- Browse/discover/nearby/search now return only OPEN tables with a future `startAt`; join requests, invite accept, and host approvals are rejected once a table has started.
- Group chat auto-closes 3 hours after the scheduled start (sooner if the host completes or closes chat); passed threads drop out of the Messages inbox.
- Table cards and detail page show “Ended” / block join on past tables while keeping meetup history in My Meetups.

### 2026-09-11 — Auth chrome on public routes

- App navbar/shell now mounts only for authenticated, protected routes — login and other public pages no longer render nav chrome.
- Back/forward navigation clears stale logged-in UI when no session token is stored.
- Public auth pages clip horizontal overflow (login mascot / hero blobs no longer cause a sideways scrollbar).

### 2026-09-11 — Login screen public polish

- Removed dev/testing affordances from web login (admin email shortcut, dev OTP display, blank-password hint).
- Replaced dev-style placeholders with concise, helpful hints on sign-in, signup, and password-reset fields.
- Buttons and links now use a pointer cursor app-wide (shared Button + base styles).

### 2026-09-06 — Featured showcase + media URL fixes

- Ported web full-bleed `FeaturedShowcase` (photos / reels via expo-av / collages).
- Fixed broken images: stop passing `.mp4` into `Image`; resolve relative `/…` URLs for RN.

### 2026-09-06 — Mobile UI port from web source

- Method shift: port web components/pages into RN (not approximate theming).
- Login, MobileTopBar, HomeDashboard (hero/vibes/table cards/rail), shared `table-cta` / covers / category icons copied from web.

### 2026-09-06 — Mobile login matches web

- Login rebuilt to mirror web: hero gradient, white wordmark, mascot + quips, white card, Poppins, same copy/flow.

### 2026-09-06 — Mobile design pass (teal brand + nav)

- Mobile theme aligned to web Nine Circles tokens (teal `#10B89B`, slate surfaces).
- Bottom tabs use Ionicons; safe-area insets via `react-native-safe-area-context`.
- Empty states on Home / Explore / Nearby / Meetups / Chats / Invites; login brand mark.

### 2026-09-06 — Mobile nav parity (Discover / Nearby / Chats)

- Bottom tabs match web: Home · Explore · Nearby · Meetups · Chats.
- Explore filters by category, when, and city; Nearby maps tables by city + radius.
- Chats unifies DMs + table groups; People (connections) and Invites from Chats/Home.
- Removed retired Events/map/feedback mobile surfaces.

### 2026-09-05 — Mobile Tables-first revival

- Expo app auth: email/password, signup OTP, password reset (replaces phone OTP).
- Default home is Tables browse/host hub; My Meetups uses hosted/joined Tables.
- Public identity shows `@username`; profile supports CoC acceptance before join.
- App display name/slug updated to Nine Circles.

### 2026-08-30 — Logout back-button + featured Cloudinary

- Logout now clears bearer token memory, localStorage, and client caches,
  uses `location.replace('/login')`, and re-checks auth on BFCache
  `pageshow` so Back after logout cannot restore a signed-in session.
- Uploaded local `public/showcase` reels/posters to Cloudinary and rewrote
  DB `/showcase/...` URLs to CDN links (prod was 404ing). Seed prefers
  `scripts/showcase-cloudinary-map.json`.

### 2026-08-29 — GSAP motion (brand-light)

- Added `gsap` + `@gsap/react` with shared helpers in `lib/motion.ts`
  (reduced-motion aware).
- Empty states use the penguin mascot (`EmptyMascot`) on Discover,
  Meetups, Invites, and Messages.
- Discover / Meetups cover grids stagger in once via `StaggerIn`.
- Mobile `SideDrawer` slides open/closed with GSAP.
- Notification unread badge soft-pulses; invite Accept gets a success ring.

### 2026-08-28 — Mobile top bar + Meetups drawers (A1)

- Sticky **MobileTopBar** on small screens (logo, search, notifications,
  avatar) alongside bottom tabs — DesktopNav unchanged at `md+`.
- **Meetups:** filters and calendar/rail open in left/right drawers on
  mobile; main list stays primary. Desktop keeps the 3-column layout.
- Shared `SideDrawer` helper for future pages (Discover, Nearby, etc.).

### 2026-08-28 — Mobile Playwright audit + polish

- Added `e2e/mobile-audit.mjs` (390×844 overflow + screenshots under
  `e2e/shots/mobile/`). All primary routes pass horizontal overflow.
- Home: vibe chips scroll horizontally on small screens.
- Discover / Meetups: filters collapse behind a tap on mobile.
- Profile: average-rating tile spans full width in the 2-col mobile grid.

### 2026-08-27 — Nine Circles brand assets

- Favicon / apple icon: teal mark (`apps/web/src/app/icon.png`).
- App logo: full Nine Circles lockup via `Wordmark` → `/brand/logo.png`
  (desktop nav, login, landing, terms/privacy). Document title updated.

### 2026-08-23 — Profile mobile overflow

- Profile section chips scroll horizontally with short labels; chips sit
  above content on small screens. Future labs checkbox copy wraps; bottom
  MobileNav reduced to five tabs (Nearby under Explore).

### 2026-08-22 — Site-wide mobile responsiveness

- Sticky bottom MobileNav on signed-in pages (`md:hidden`); no bottom pad on
  table chat; DesktopNav unchanged at `md+`.
- Discover, Nearby, Meetups, Search, Profile: main content first on small
  screens; filter/right rails reorder or hide; scrollable tabs where needed.
- Messages: list/thread swap on small screens. Nearby rows stack CTA under meta.
- Compact titles/headers across Requests, Notifications, Calendar, Invites,
  Saved, Invite, Create/Edit table, admin console, Terms/Privacy.

### 2026-08-22 — Home mobile responsiveness

- Signed-in home uses the same dashboard on mobile (Moments, tables, rail)
  instead of the tile-only launcher; desktop layout unchanged (`md+` nav).
- Mobile: compact hero, shorter Featured height, horizontal quick nav.

### 2026-08-21 — Lahore Instagram launch plan

- Added `tasks/2026-08-21-lahore-instagram-launch-plan.md`: Lahore 20–28,
  Instagram-only funnel, company + community hosting, WhatsApp payment Phase 1,
  4-week calendar, sample copy, and ~$350–550 month-1 ad budget.

### 2026-08-20 — Admin Moments access on tables

- Admins/organizers can view, upload, and delete Moments on any table page
  (same controls as the host), not only as approved guests.

- Featured home section supports **photos, muted autoplay reels, and collages**
  (Instagram-style story progress; collage cells can be videos).
- Admins can set per-slide **layout**: fit (cover/contain), scale, focus position,
  and asymmetric collage grids including the **masonry-9** staggered template.
- `TableImage` gains `kind` (`IMAGE`/`VIDEO`/`COLLAGE`), `layout` JSON, poster,
  duration, collage URLs, caption, sort order.
- Hosts can upload reels (`POST /tables/:id/videos`) and build collages
  (`POST /tables/:id/collages`); admin Featured picker shows Reel/Collage badges.
- Local demo seed **amends** Featured Moments (does not delete existing `[ig]`
  rows): memories reel + masonry collage kept; EVENT P3 reel restored; extra
  reels added. `apps/api/scripts/seed-featured-showcase.ts`.

### 2026-08-19 — Interest mix radar graph (Future labs)

- Own-profile interest mix now includes a radar graph plus reliability /
  peer-rating tiles (from tables, stated interests, and reviews).
- Still gated by `NEXT_PUBLIC_FUTURE_TASKS` (`false` to show).
- Playwright: `e2e/future-labs-check.mjs` seeds history and asserts the graph.

### 2026-08-19 — Future features pack (flag-gated)

- Plan: `tasks/future-features-plan.md`.
- Flag: `NEXT_PUBLIC_FUTURE_TASKS` — `true`/unset hides UI; `false` shows it.
- Self prefs: `surpriseMeOptIn`, `remindBeforeMeetup` (migration).
- Interest mix API `GET /users/me/interest-mix` + Profile “Future labs” panel
  (mix bars, Surprise Me, reminders, stubs for templates/waitlist/no-show).

### 2026-08-15 — Member profiles admin-only

- Other members' `/u/[id]` pages are visible to admins (and organizers) only;
  API `GET /users/:id/profile` returns 403 for everyone else (self still allowed).
- Connect and Message on public profiles are admin-only.
- `UserLink` (handles in chat, tables, invites, etc.) no longer navigates for
  non-admins; own identity still opens `/profile`.

### 2026-08-15 — UI list cache on remaining table pages

- Nearby, Search, Calendar, Saved, Invites, Profile, and the tables map share
  the same client SWR cache keys as Discover/Meetups (browse / joined / hosted /
  saved / invites).
- Map poll writes through `putCache` so other pages pick up fresh browse data.

### 2026-08-15 — Instant UI cache paint for home / lists

- Home no longer waits on notifications/featured before clearing the spinner.
- List cache hydrates from memory + sessionStorage on first paint; SWR fresh
  window extended to 60s (stale 5m).

### 2026-08-15 — Redis + UI cache for Discover / Meetups

- Backend caches shared OPEN browse list and per-user joined/hosted/saved lists
  in Redis (TTL safety net + explicit invalidation on create/update/join/leave/
  approve/decline/complete/save/invite-accept/admin cancel·delete·kick).
- Admin flush: `POST /admin/cache/invalidate` and `DELETE /admin/cache`.
- Web Discover, Meetups, and home use in-memory stale-while-revalidate; mutations
  clear the client `tables:` cache prefix.

### 2026-08-15 — Messages overlay scrollbars

- Left / center / right Messages panes use fade overlay scrollbars: hidden until
  scroll (or hover), thin thumb, no classic Windows width steal.

### 2026-08-15 — Account lock seal + table chat close + host kick

- **Admin Suspend / Ban** already locked accounts; auth now seals login, OTP,
  password reset, and clears stale web tokens so locked users cannot re-enter
  chats or APIs.
- Table group chat **auto-closes 24h after** `completedAt`; host and admin can
  **close chat early**. Closed chats are read-only (no send/reactions).
- **Host** can remove approved guests (seat restored); admin remove path
  unchanged and shares the same service logic.
- Migration: `20260815140000_table_chat_closed_at`.

### 2026-08-14 — Guest review window (2 days); host never closes

- After the host ends a meetup (`completedAt`), **guests** have **2 days** to
  submit reviews; then the guest window auto-closes.
- **Hosts** keep review access indefinitely (required to review).
- Guest-side 50% score average uses **only submitted** ratings (never divides by
  missing reviewers). Documented join vs reviewed tracking in `docs/features.md`.
- Migration: `20260814030000_table_completed_at`.

### 2026-08-14 — Review score weight + joiner UI

- **Overall score** = 50% average of reviews written by table hosts + 50% average
  of reviews written by guests (one side only → that side at 100%).
- Non-hosts see **overall only** on self/public rating UI; hosts still see
  overall plus as-host / as-guest breakdown.

### 2026-08-14 — English maps, Pakistan-only

- All MapLibre surfaces use OpenFreeMap English-oriented tiles and are
  max-bounded to Pakistan (create/edit pin, Nearby, Search).
- Venue geocode is English + Pakistan bbox only (no out-of-country results).

### 2026-08-14 — Peer review API redeploy

- Pushed a reviews-service touch so production API rebuilds mutual
  host/guest review targets (joiners see all other attendees, not only host).

### 2026-08-14 — My Meetups stays open until table is closed

- Hosted and joined (approved/pending) tables remain in **My Meetups** after
  `startAt` as long as status is not `CANCELLED` or `COMPLETED`.
- **Past** shows completed hosted/joined tables only (no overlap with open ones).

### 2026-08-13 — Invite picker: handle search only

- Table “Invite people” no longer pre-lists connections; the list stays empty
  until the host searches by `@username`.
- Member search matches username only (not email, phone, name, or occupation).

### 2026-08-13 — Multi-category pills on Table UI

- Comma-separated / multi-select categories now render as **separate pills** on
  table detail and listing cards (Discover, home, Meetups, Nearby, Saved,
  Invites, Search, Calendar), via shared `CategoryPills` + `splitCategories`.
- Category filters match any part of a multi-category table.

### 2026-08-13 — Venue map pin drops on search select

- On Table create/edit (and admin cafes), choosing a venue search result fills
  name/address/coords, **drops the LocationPicker pin on that point**, flies the
  map camera there, and scrolls the map into view.
- Documented in [`docs/features.md`](docs/features.md).

### 2026-08-13 — Peer reviews with score-only profiles

- After a Table’s start time, the host and approved guests can rate **each other**
  (not only guest → host). Leave-review UI continues to use existing review-target
  endpoints.
- Self and public profiles show calculated scores only (`overallRating` plus host /
  guest breakdowns). Individual review comments are no longer returned on
  user-facing reputation endpoints; admins still moderate full reviews.
- **No DB migration** — peer reviews reuse the existing `Review` unique key
  `(tableId, reviewerId, subjectId)`; scores remain on-read aggregates.
- Feature wiring and edge cases documented in [`docs/features.md`](docs/features.md).
- Feature map (wiring, edge cases, file layout): [`docs/features.md`](docs/features.md).

### 2026-08-13 — Create-account email gate

- Creating an account with an email that already exists is blocked before an OTP
  is sent; users are directed to sign in or forgot-password instead.

### 2026-08-13 — Protect authenticated web routes

- Added a centralized route guard that redirects logged-out users to `/login`
  and leaves only authentication and legal pages publicly accessible.

### 2026-08-13 — Auto-detect password setup

- Existing accounts without a password now automatically enter email OTP
  password setup from the sign-in form.
- Unknown emails remain on the normal invalid-login path, while accounts that
  already have passwords cannot use the first-login OTP flow.

### 2026-08-13 — Password login and password reset

- First-time account verification continues to use email OTP and now requires
  setting a password.
- Subsequent sign-ins use email and password instead of OTP.
- Added email-OTP password reset with automatic sign-in after a successful reset.
- Added salted scrypt password hashing and a nullable migration-safe password
  field; existing accounts can complete password setup through the first-login
  email flow.

### 2026-08-13 — Table banner upload on create/edit

- Hosts can upload an optional **banner image** while creating or editing a
  Table (`/tables/new`, `/tables/[id]/edit`): preview, replace, and remove.
- Upload goes through `POST /tables/cover` (host-only) into media storage; the
  returned URL is saved as `Table.imageUrl`. If skipped/removed, cards fall back
  to the existing category cover. (`banner-picker`, tables create/update DTOs,
  api-client `uploadTableCover`)

### 2026-08-12 — Meetups: hide past & cancelled events from active views

- **Cancelled tables are hidden everywhere.** `applyFilters` now drops any
  `CANCELLED` table from every browse/active list, and drops `COMPLETED` ones
  from all non-"past" views.
- **"My Meetups" & "Upcoming" show only live upcoming commitments.** Past,
  cancelled and completed tables no longer appear there — they belong in the
  **Past** tab. The Past tab also excludes cancelled tables. (`meetups`)

### 2026-08-12 — Explore: remove redundant "View all" / "See all"

- Removed the self-linking **"View all"** (Top categories) and **"See all"**
  (Recommended for you) buttons on `/discover` — both pointed back to the same
  page. Kept the functional "Your upcoming → View all" (→ /meetups).

### 2026-08-12 — Privacy identity: public @handle, private name/phone/email

- **Handles are the public identity.** Every account now has a unique `@username`.
  Other members see ONLY the handle — never your real name, phone, or email.
  Public profile, table host/participants, join requests, group & event chat,
  DMs, connections, invites, reviews and member search all render `@handle`.
- **Real name + phone + email are private.** Visible only to you (your own
  profile/settings) and to admins. The API strips name/phone/email from
  `toPublicUser`; only `toSelfUser` and admin endpoints include them. (Fixed the
  leak where phone rode along in every public user payload.)
- **Phone still required per account** — it stays a unique, mandatory field (the
  admin lifeline to reach people); it's just no longer shown to other users.
  Email is likewise unique + private, and remains the OTP login key.
- **Signup collects name + handle.** New users pick a public `@handle` (live
  availability check, 3–20 chars) and give their first + last name and phone.
  Copy makes it explicit: *"Your @handle is public. Your name, phone & email stay
  private."* Duplicate handle/phone/email are rejected.
- **Profile edit** gains Handle + First/Last name fields; the home dashboard shows
  a "finish your profile" prompt to existing users missing a name.
- Backend: `username`/`lastName` columns (+ migration + backfill of handles for
  existing users), `GET /users/username-available`, handle validation shared util.

### 2026-08-12 — Venue place-search when creating/editing an event

- **Place search (free, no API key).** The "Choose venue" step on both the
  create (`tables/new`) and edit (`tables/[id]/edit`) forms now has a debounced
  search box: type a place → pick a suggestion → it auto-fills the venue name +
  address and drops the map pin (lat/lng). Manual entry + pin-drop still work.
- **Backend geocode proxy.** New `GET /geocode?q=` (authenticated) proxies the
  Photon/OSM geocoder server-side (proper User-Agent, Pakistan-biased, 6s
  timeout) and returns simplified `{name, label, lat, lng}` results.
  (`geo` module, `GeocodeResult` type, `api.geocode`, `VenueSearch` component)

### 2026-08-11 — Invited state, skeletons, grouped Featured carousel

- **Invited state everywhere.** `browse`/`findOne` now include the viewer's
  pending invite (`myInvite`). Table cards (Explore/Home/Meetups) show
  **"Invited"** instead of "Join Table", and the single table page shows a
  **"You're invited" banner with Accept / Decline**. (`tables.service`, `types`,
  `table-cta`, `tables/[id]`, `meetups`)
- **Skeleton loaders on Explore + Nearby.** Both pages now show pulse skeleton
  cards while data loads (instead of a spinner), and Explore's "Trending now" /
  "Popular cities" show skeletons instead of a "0 tables" flash. (`discover`,
  `tables/nearby`)
- **Featured = one carousel per event.** The home Featured section groups photos
  by event — each event gets its own header + horizontal carousel of wider
  images. (`home-dashboard`)


### 2026-08-11 — Join-state cards, event name + multi-category, real presence

- **"Join Table" no longer shows for tables you've already joined.** The list
  endpoints (`browse`, `mineSaved`) now return the viewer's `myRequestStatus`,
  so cards correctly show Going/Requested/Hosting/Full. (`tables.service`)
- **Create meetup: event name + multiple categories.** New "Event name" field
  (→ `title`, shown as the card/page title). Category is now multi-select
  (toggle chips) plus comma-separated custom entries, stored comma-joined.
  Category icons/filters/trending/vibes split multi-categories so a table shows
  under each of its categories. (`tables/new`, `category-icon`, `discover`,
  `home-dashboard`, `create-table.dto` length 60→200)
- **Real online presence.** New `User.lastSeenAt`, bumped (throttled) on each
  authenticated request; `PublicUser.online` = active in the last 5 min. The
  messages "Active now" section now shows only connections who are actually
  online, and avatar green dots are real (were hardcoded). (`session.guard`,
  `user.serializer`, `types`, `messages`)


### 2026-08-11 — Admin Featured picker: search + filters

- The `/admin/featured` page now lets admins **find events** with a search box +
  filters (status, date range, "only events with photos", "my bookmarked
  events") instead of a plain dropdown. Each event card shows its status, date,
  venue, photo count, and featured count; selecting one opens its photos to
  feature. `GET /admin/featured/tables` gained query params
  (q/status/from/to/hasPhotos/bookmarked). (`admin.service`, `types`, client,
  `admin/featured/page.tsx`)


### 2026-08-11 — Admin: featured event photos on home

- **Admin can curate a "Featured" section on the home page.** New `/admin/featured`
  page: pick an event (any table with photos) and tap its event photos to feature
  them. New `TableImage.featured` flag (+ migration). Endpoints:
  `GET /admin/featured/tables`, `GET /admin/tables/:id/images`,
  `POST /admin/images/:imageId/feature` (all audited), and public
  `GET /tables/featured`. Home dashboard shows a "Featured" gallery of the
  curated photos (labeled by event, links to the table) when any are featured.


### 2026-08-11 — Chat ordering + unread indicators

- **Conversations now sort by most-recent message.** Group chats previously used
  the event start date (often future) as their sort key and showed a hardcoded
  "Group chat" text with no unread — so the list wasn't in message order. New
  `GET /tables/mine/group-threads` returns each group's real last message,
  last-message time, and unread count; the messages page merges DM + group into
  one list sorted by recency.
- **Unread indicators for group chats.** New `GroupChatRead` model (per-user
  read marker) + `POST /tables/:id/read`. Group conversations show a real unread
  badge; opening a chat marks it read (messages page + the standalone table chat
  page). The messages page now polls the thread list every 8s so unread badges
  and ordering update live when new messages arrive.


### 2026-08-11 — Host: end event + event photos

- **Host can end an event.** New `POST /tables/:id/complete` (host-only) marks
  the table COMPLETED and unlocks reviews. Detail page shows an "End event"
  button for the host (hidden once completed/cancelled → "Event ended").
- **Event photo sharing.** New `TableImage` model + endpoints: host uploads via
  `POST /tables/:id/images` (image ≤5MB → Cloudinary), members view via
  `GET /tables/:id/images`, host removes via `DELETE`. Detail page gains an
  "Event photos" gallery — the host can add/delete; approved members view only;
  non-members don't see it. (`tables.service/controller`, `types`, client,
  `tables/[id]/page.tsx`)


### 2026-08-10 — Table card CTA state + invite search

- **Table card button now reflects the viewer's relationship** instead of always
  saying "Join Table": shows "Hosting" (you host it), "Going" (approved),
  "Requested" (pending), or "Full", else "Join Table". Fixes hosts/admins seeing
  "Join Table" on their own tables and already-joined members seeing it too.
  Shared `lib/table-cta.ts` helper used by the Discover, Search, and Home cards.
- **Invite people is now a searchable box.** The host invite list on the table
  detail page gained a search input that filters people by name (scrollable
  results), instead of a long static list. (`tables/[id]/page.tsx`)


### 2026-08-10 — Host requests nav + profile email

- **Host "Requests" inbox reachable on desktop.** The approve/decline page
  (`/requests`) and its pending badge already existed but weren't in the desktop
  top nav (only mobile tiles), so hosts couldn't find it. Added a host-only
  "Requests" nav item with the live pending-count badge. (`desktop-nav.tsx`)
- **Profile now shows the account email as Verified** instead of a hardcoded
  "Not added". Root cause: the UI never read `user.email`, and `me()` dropped
  email (`toPublicUser`) while `verify-otp` returned the *raw* user (leaking
  sensitive fields). Added a self-only `toSelfUser` serializer (email included)
  used by `me()` + `verify-otp`; `email` added to `PublicUser` as an
  owner-only optional field (never populated for other users). Wired the
  profile Identity section + sidebar to `user.email`.
  (`user.serializer.ts`, `auth.controller.ts`, `types`, `profile/page.tsx`)


### 2026-08-10 — Home dashboard skeletons

- **Home dashboard** now shows skeleton loaders while data fetches, instead of
  flashing the "No open tables" empty state + zeroed stats before content
  arrives. Added a `busy` flag and pulse placeholders for "Popular vibes" and
  the "Tables near you" cards. (`components/home-dashboard.tsx`)


### 2026-08-10 — Discover sidebars, profile deep-link + photo upload

- **Discover sticky sidebars** (Filters, Trending/Upcoming/Cities) now have their
  own capped height + independent scroll (`lg:max-h-[calc(100vh-7rem)]
  lg:overflow-y-auto`), so their last items are reachable without scrolling the
  whole page. Mobile unchanged; no scrollbar unless content overflows.
  (`discover/page.tsx`)
- **Profile "#code-of-conduct" deep-link fixed.** The table "Accept in profile"
  CTA links to `/profile#code-of-conduct`, but the section was chosen in a
  `useState` initializer that runs during SSR (window undefined) and isn't
  re-run on hydration → the hash was ignored and you landed on Overview. Now a
  client effect reads the hash, opens the settings section, and scrolls the
  consent checkbox into view. (`profile/page.tsx`)
- **Profile photo upload restrictions.** Client now enforces image type
  (JPG/PNG/WebP) + ≤5 MB before upload (matches the backend), with a clear
  inline error instead of a failed round-trip. (`profile/page.tsx`)


### 2026-08-10 — Logout + OTP delivery fixes

- **Logout was stuck / kept you on the same screen.** `logout()` awaited the
  server call first, so a CSRF/session error left client state uncleared and
  never navigated. Now it clears local state even if the network call fails and
  hard-redirects to `/login`. (`auth-provider.tsx`) There is no route
  guard/middleware — pages gate inline with `if (!user)`.
- **`request-otp` hung (deployed "Sending…" forever).** The OTP send was
  awaited (`otp.service.ts`), so a stalled SMTP connection (common on cloud
  hosts / Gmail) blocked the HTTP response. The code is already persisted before
  the send, so email is now fire-and-forget → `request-otp` returns immediately.
- **SMTP timeouts** added to the mailer transport (connection/greeting/socket)
  so a blocked host fails fast instead of hanging. (`mail.service.ts`)
- **Admin test login** email changed to a real (yopmail) inbox so OTP is
  actually receivable; login screen hint updated. (`login/page.tsx`)


### 2026-08-10 — Discover / Meetups / table-card fixes (from design review)

- **Meetups:** "+ Create Meetup" button now shows only for hosts (`user.canHost`), not every user. (`meetups/page.tsx`)
- **Discover — Trending now:** removed the broken/self-referential "View all" link. (`discover/page.tsx`)
- **Connects:** hidden all connect UI for now — removed the "Suggested for you" people card on Discover + Search, the Connect buttons, and the "Connections" links/entry points on Profile, Messages, and the table detail page. Backend + `/connections` route left intact. (`discover/page.tsx`, `search/page.tsx`, `profile/page.tsx`, `messages/page.tsx`, `tables/[id]/page.tsx`)
- **Discover — Popular cities:** removed the "View all" link (if present). (`discover/page.tsx`)
- **Table card:** Discover card now shows the event **date/time** (was missing; Search/Meetups already did). All table cards now show **distance from the user** and a **Google Maps pin link** for the event location. (`discover/page.tsx`, `search/page.tsx`, `lib/geo.ts`)
- **Meetups:** added **skeleton loading** for the Upcoming / My Meetups lists while data fetches (previously jumped straight to empty states). (`meetups/page.tsx`)
