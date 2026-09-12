/** Matches API browse/join rules — table is still open for new guests. */
export function isUpcomingTable(
  startAt: string | Date,
  now = Date.now(),
): boolean {
  return new Date(startAt).getTime() > now;
}

/** Public discovery lists — never show a meetup that has already started. */
export function upcomingDiscoverTables<T extends { startAt: string | Date; status?: string }>(
  tables: T[],
  now = Date.now(),
): T[] {
  return tables.filter(
    (t) =>
      isUpcomingTable(t.startAt, now) &&
      t.status !== 'COMPLETED' &&
      t.status !== 'CANCELLED',
  );
}

/** Matches API group-chat close rules (manual, post-complete, post-start grace). */
export const MEETUP_CHAT_GRACE_MS = 3 * 60 * 60 * 1000;
const CHAT_AUTO_CLOSE_MS = 24 * 60 * 60 * 1000;

export function isGroupChatOpen(
  table: {
    startAt: string | Date;
    completedAt?: string | null;
    chatClosedAt?: string | null;
  },
  now = Date.now(),
): boolean {
  const startMs = new Date(table.startAt).getTime();
  const candidates = [startMs + MEETUP_CHAT_GRACE_MS];
  if (table.chatClosedAt) {
    candidates.push(new Date(table.chatClosedAt).getTime());
  }
  if (table.completedAt) {
    candidates.push(new Date(table.completedAt).getTime() + CHAT_AUTO_CLOSE_MS);
  }
  return now < Math.min(...candidates);
}
