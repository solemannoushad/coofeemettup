import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { ReactionsService } from '../reactions/reactions.service';
import { MediaService } from '../media/media.service';
import { CacheService } from '../redis/cache.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { Prisma } from '../../generated/prisma/client';
import { toPublicUser } from '../users/user.serializer';
import {
  assertJoinableTable,
  isChatClosed as isTableChatClosed,
  isUpcomingTable,
} from './table-time';

// Public identity only — hosts/participants are shown by @handle, never real name.
const HOST_SELECT = { id: true, username: true };

type BrowseTableRow = Prisma.TableGetPayload<{
  include: { cafe: true; host: { select: typeof HOST_SELECT } };
}>;

@Injectable()
export class TablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly reactions: ReactionsService,
    private readonly media: MediaService,
    private readonly cache: CacheService,
  ) {}

  // ---------- host: end event + event photos ----------

  /** Host marks the event finished → status COMPLETED (unlocks reviews). */
  async complete(userId: string, tableId: string) {
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
    });
    if (!table) throw new NotFoundException('Table not found');
    if (table.hostId !== userId) {
      throw new ForbiddenException('Only the host can end this event');
    }
    if (table.status === 'CANCELLED') {
      throw new ConflictException('This event was cancelled');
    }
    if (table.status !== 'COMPLETED') {
      await this.prisma.table.update({
        where: { id: tableId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      void this.audit.log({
        actorId: userId,
        action: 'table.completed',
        targetType: 'table',
        targetId: tableId,
      });
      void this.cache.invalidateTableMutation({ hostId: table.hostId });
    } else if (table.completedAt == null) {
      // Legacy COMPLETED rows without a stamp — set once so the review window can close.
      await this.prisma.table.update({
        where: { id: tableId },
        data: { completedAt: new Date() },
      });
      void this.cache.invalidateTableMutation({ hostId: table.hostId });
    }
    return this.findOne(userId, tableId);
  }

  /**
   * Upload a cover/banner image and return its URL. Used at create time (before
   * a table exists) so the host can set a banner; the URL is then passed as
   * `imageUrl` on create/update.
   */
  async uploadCover(userId: string, buffer: Buffer): Promise<{ url: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { canHost: true },
    });
    if (!user?.canHost) {
      throw new ForbiddenException('Only approved hosts can upload banners');
    }
    const url = await this.media.uploadImage(buffer, 'table-covers');
    return { url };
  }

  /** Host uploads an event photo (already stored via MediaService). */
  async addImage(userId: string, tableId: string, buffer: Buffer) {
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
    });
    if (!table) throw new NotFoundException('Table not found');
    if (!(await this.canManageMedia(userId, table))) {
      throw new ForbiddenException(
        'Only the host or an admin can add event photos',
      );
    }
    const url = await this.media.uploadImage(buffer, 'table-photos');
    return this.prisma.tableImage.create({
      data: { tableId, url, uploadedById: userId, kind: 'IMAGE' },
    });
  }

  /** Host uploads a short reel / video for the table gallery. */
  async addVideo(
    userId: string,
    tableId: string,
    buffer: Buffer,
    caption?: string,
  ) {
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
    });
    if (!table) throw new NotFoundException('Table not found');
    if (!(await this.canManageMedia(userId, table))) {
      throw new ForbiddenException('Only the host or an admin can add reels');
    }
    const uploaded = await this.media.uploadVideo(buffer, 'table-reels');
    return this.prisma.tableImage.create({
      data: {
        tableId,
        url: uploaded.url,
        kind: 'VIDEO',
        posterUrl: uploaded.posterUrl,
        durationMs: uploaded.durationMs,
        caption: caption?.trim() || null,
        uploadedById: userId,
      },
    });
  }

  /**
   * Host builds a collage slide from existing IMAGE gallery rows (2–9 photos).
   * Creates one COLLAGE media row; originals stay in the gallery.
   */
  async createCollage(
    userId: string,
    tableId: string,
    imageIds: string[],
    caption?: string,
  ) {
    if (imageIds.length < 2 || imageIds.length > 9) {
      throw new BadRequestException('Collage needs 2–9 photos');
    }
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
    });
    if (!table) throw new NotFoundException('Table not found');
    if (!(await this.canManageMedia(userId, table))) {
      throw new ForbiddenException(
        'Only the host or an admin can create collages',
      );
    }
    const imgs = await this.prisma.tableImage.findMany({
      where: {
        tableId,
        id: { in: imageIds },
        kind: 'IMAGE',
      },
    });
    if (imgs.length !== imageIds.length) {
      throw new BadRequestException(
        'All collage photos must belong to this table',
      );
    }
    const ordered = imageIds
      .map((id) => imgs.find((i) => i.id === id)!)
      .filter(Boolean);
    const [primary, ...rest] = ordered;
    return this.prisma.tableImage.create({
      data: {
        tableId,
        url: primary.url,
        kind: 'COLLAGE',
        collageUrls: rest.map((i) => i.url),
        posterUrl: primary.url,
        caption: caption?.trim() || null,
        uploadedById: userId,
        layout:
          ordered.length === 9
            ? { fit: 'cover', collage: { preset: 'masonry-9' } }
            : ordered.length >= 3
              ? { fit: 'cover', collage: { preset: 'hero-left' } }
              : { fit: 'cover', collage: { preset: 'split-70-30' } },
      },
    });
  }

  /** Host, approved guests, and admins can view event media. */
  async listImages(userId: string, tableId: string) {
    if (!(await this.canViewMedia(userId, tableId))) {
      throw new ForbiddenException(
        'Only the host, approved members, or an admin can view photos',
      );
    }
    return this.prisma.tableImage.findMany({
      where: { tableId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
  }

  /** Host or admin can remove an event photo. */
  async deleteImage(userId: string, tableId: string, imageId: string) {
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
    });
    if (!table) throw new NotFoundException('Table not found');
    if (!(await this.canManageMedia(userId, table))) {
      throw new ForbiddenException(
        'Only the host or an admin can remove event photos',
      );
    }
    await this.prisma.tableImage.deleteMany({
      where: { id: imageId, tableId },
    });
    return { ok: true as const };
  }

  /** Admin-curated featured media for the home showcase (photos, reels, collages). */
  async featuredImages() {
    const imgs = await this.prisma.tableImage.findMany({
      where: { featured: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      take: 24,
      include: { table: { select: { id: true, title: true, category: true } } },
    });
    return imgs.map((i) => ({
      id: i.id,
      url: i.url,
      kind: i.kind,
      posterUrl: i.posterUrl,
      durationMs: i.durationMs,
      collageUrls: i.collageUrls,
      layout: (i.layout as Record<string, unknown> | null) ?? null,
      caption: i.caption,
      tableId: i.tableId,
      tableTitle: i.table.title,
      category: i.table.category,
    }));
  }

  // ---------- group chat threads (list + unread) ----------

  /** Group-chat conversation summaries (last message + unread) for the sidebar. */
  async groupThreads(userId: string) {
    const hosted = await this.prisma.table.findMany({
      where: { hostId: userId },
      include: { cafe: true, host: { select: HOST_SELECT } },
    });
    const approved = await this.prisma.tableJoinRequest.findMany({
      where: { userId, status: 'APPROVED' },
      include: {
        table: { include: { cafe: true, host: { select: HOST_SELECT } } },
      },
    });
    const byId = new Map<string, (typeof hosted)[number]>();
    for (const t of hosted) byId.set(t.id, t);
    for (const r of approved)
      if (!byId.has(r.table.id)) byId.set(r.table.id, r.table);
    const tables = [...byId.values()].filter(
      (t) => !isTableChatClosed(t).closed,
    );
    const tableIds = tables.map((t) => t.id);
    if (tableIds.length === 0) return [];

    const messages = await this.prisma.groupMessage.findMany({
      where: { groupId: { in: tableIds } },
      orderBy: { createdAt: 'desc' },
      select: { groupId: true, body: true, userId: true, createdAt: true },
    });
    const reads = await this.prisma.groupChatRead.findMany({
      where: { userId, tableId: { in: tableIds } },
    });
    const readByTable = new Map(reads.map((r) => [r.tableId, r.lastReadAt]));

    const result = tables.map((t) => {
      const msgs = messages.filter((m) => m.groupId === t.id);
      const last = msgs[0] ?? null; // desc → first is latest
      const lastReadAt = readByTable.get(t.id) ?? new Date(0);
      const unread = msgs.filter(
        (m) => m.userId !== userId && m.createdAt > lastReadAt,
      ).length;
      return {
        table: t,
        lastMessage: last?.body ?? null,
        lastAt: (last?.createdAt ?? t.createdAt).toISOString(),
        unread,
      };
    });
    result.sort(
      (a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime(),
    );
    return result;
  }

  /** Mark a table's group chat as read up to now (clears its unread count). */
  async markGroupRead(userId: string, tableId: string) {
    if (!(await this.isMember(userId, tableId))) {
      throw new ForbiddenException('Not a member of this table');
    }
    await this.prisma.groupChatRead.upsert({
      where: { userId_tableId: { userId, tableId } },
      create: { userId, tableId },
      update: { lastReadAt: new Date() },
    });
    return { ok: true as const };
  }

  // ---------- hosting ----------
  async create(userId: string, dto: CreateTableDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.canHost) {
      throw new ForbiddenException('Only approved hosts can create tables');
    }
    if (!dto.cafeId && (dto.lat == null || dto.lng == null)) {
      throw new BadRequestException('Pick a cafe or drop a location pin');
    }
    if (dto.cafeId) {
      const cafe = await this.prisma.cafe.findUnique({
        where: { id: dto.cafeId },
      });
      if (!cafe) throw new NotFoundException('Cafe not found');
    }

    const table = await this.prisma.table.create({
      data: {
        hostId: userId,
        cafeId: dto.cafeId ?? null,
        venueName: dto.venueName ?? null,
        venueAddress: dto.venueAddress ?? null,
        lat: dto.lat ?? null,
        lng: dto.lng ?? null,
        title: dto.title ?? null,
        imageUrl: dto.imageUrl ?? null,
        startAt: new Date(dto.startAt),
        seats: dto.seats,
        seatsLeft: dto.seats,
        category: dto.category,
        description: dto.description ?? null,
        rules: dto.rules ?? null,
        pricePKR: dto.pricePKR ?? null,
        status: 'OPEN',
      },
    });
    void this.audit.log({
      actorId: userId,
      action: 'table.created',
      targetType: 'table',
      targetId: table.id,
      meta: { category: table.category, seats: table.seats },
    });
    void this.cache.invalidateTableMutation({ hostId: userId });
    return table;
  }

  /** Host edits event details — only before it starts and while active. */
  async update(userId: string, tableId: string, dto: UpdateTableDto) {
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
    });
    if (!table) throw new NotFoundException('Table not found');
    if (table.hostId !== userId) {
      throw new ForbiddenException('Only the host can edit this event');
    }
    if (table.status === 'CANCELLED' || table.status === 'COMPLETED') {
      throw new BadRequestException('This event can no longer be edited');
    }
    if (new Date(table.startAt).getTime() <= Date.now()) {
      throw new BadRequestException('The event has already started');
    }

    const data: Prisma.TableUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim() || null;
    if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl || null;
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.description !== undefined)
      data.description = dto.description.trim() || null;
    if (dto.rules !== undefined) data.rules = dto.rules.trim() || null;
    if (dto.pricePKR !== undefined) data.pricePKR = dto.pricePKR ?? null;
    if (dto.venueName !== undefined)
      data.venueName = dto.venueName.trim() || null;
    if (dto.venueAddress !== undefined)
      data.venueAddress = dto.venueAddress.trim() || null;
    if (dto.lat !== undefined) data.lat = dto.lat;
    if (dto.lng !== undefined) data.lng = dto.lng;
    if (dto.startAt !== undefined) data.startAt = new Date(dto.startAt);

    if (dto.seats !== undefined) {
      const filled = table.seats - table.seatsLeft;
      if (dto.seats < filled) {
        throw new BadRequestException(
          `${filled} seat(s) are already taken — can't reduce below that`,
        );
      }
      data.seats = dto.seats;
      data.seatsLeft = dto.seats - filled;
      data.status = dto.seats - filled > 0 ? 'OPEN' : 'FULL';
    }

    await this.prisma.table.update({ where: { id: tableId }, data });
    void this.audit.log({
      actorId: userId,
      action: 'table.updated',
      targetType: 'table',
      targetId: tableId,
    });
    void this.cache.invalidateTableMutation({ hostId: userId });
    return this.findOne(userId, tableId);
  }

  async mineHosting(userId: string) {
    const key = this.cache.mineHostingKey(userId);
    const cached = await this.cache.getJson<BrowseTableRow[]>(key);
    if (cached) return cached;

    const rows = await this.prisma.table.findMany({
      where: { hostId: userId },
      include: { cafe: true, host: { select: HOST_SELECT } },
      orderBy: { startAt: 'desc' },
    });
    await this.cache.setJson(key, rows, CacheService.TTL_MINE_SEC);
    return rows;
  }

  // ---------- discovery ----------
  private async savedSet(userId: string): Promise<Set<string>> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { savedTableIds: true },
    });
    return new Set(u?.savedTableIds ?? []);
  }

  async browse(userId: string) {
    let tables = await this.cache.getJson<BrowseTableRow[]>(
      CacheService.BROWSE_OPEN,
    );
    const now = new Date();
    if (!tables) {
      tables = await this.prisma.table.findMany({
        where: { status: { in: ['OPEN', 'FULL'] }, startAt: { gt: now } },
        include: { cafe: true, host: { select: HOST_SELECT } },
        orderBy: { startAt: 'asc' },
      });
      await this.cache.setJson(
        CacheService.BROWSE_OPEN,
        tables,
        CacheService.TTL_BROWSE_SEC,
      );
    }
    // Always drop ended rows — Redis TTL can outlive startAt, and older
    // payloads may not have been queried with a start filter.
    tables = tables.filter((t) => isUpcomingTable(t.startAt, now.getTime()));
    // Per-viewer fields stay live (cheap) so we can share one browse cache.
    const saved = await this.savedSet(userId);
    const ids = tables.map((t) => t.id);
    const statusBy = await this.myStatusByTable(userId, ids);
    const inviteBy = await this.myInviteByTable(userId, ids);
    return tables.map((t) => ({
      ...t,
      saved: saved.has(t.id),
      myRequestStatus: statusBy.get(t.id) ?? null,
      myInvite: inviteBy.get(t.id) ?? null,
    }));
  }

  /** The viewer's join-request status per table id (for card CTAs). */
  private async myStatusByTable(userId: string, tableIds: string[]) {
    if (tableIds.length === 0) return new Map<string, string>();
    const reqs = await this.prisma.tableJoinRequest.findMany({
      where: { userId, tableId: { in: tableIds } },
      select: { tableId: true, status: true },
    });
    return new Map(reqs.map((r) => [r.tableId, r.status]));
  }

  /** The viewer's PENDING invite (id + status) per table id. */
  private async myInviteByTable(userId: string, tableIds: string[]) {
    if (tableIds.length === 0) {
      return new Map<string, { id: string; status: string }>();
    }
    const invs = await this.prisma.tableInvite.findMany({
      where: {
        inviteeId: userId,
        tableId: { in: tableIds },
        status: 'PENDING',
      },
      select: { id: true, tableId: true, status: true },
    });
    return new Map(
      invs.map((iv) => [iv.tableId, { id: iv.id, status: iv.status }]),
    );
  }

  async findOne(userId: string, id: string) {
    const table = await this.prisma.table.findUnique({
      where: { id },
      include: { cafe: true, host: { select: HOST_SELECT } },
    });
    if (!table) throw new NotFoundException('Table not found');
    const mine = await this.prisma.tableJoinRequest.findUnique({
      where: { tableId_userId: { tableId: id, userId } },
    });
    const invite = await this.prisma.tableInvite.findUnique({
      where: { tableId_inviteeId: { tableId: id, inviteeId: userId } },
      select: { id: true, status: true },
    });
    return {
      ...table,
      myRequestStatus: mine?.status ?? null,
      myInvite:
        invite && invite.status === 'PENDING'
          ? { id: invite.id, status: invite.status }
          : null,
      saved: (await this.savedSet(userId)).has(id),
    };
  }

  async mineJoined(userId: string) {
    const key = this.cache.mineJoinedKey(userId);
    const cached =
      await this.cache.getJson<
        Array<BrowseTableRow & { myRequestStatus: string; saved: boolean }>
      >(key);
    if (cached) return cached;

    const reqs = await this.prisma.tableJoinRequest.findMany({
      where: { userId },
      include: {
        table: { include: { cafe: true, host: { select: HOST_SELECT } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const saved = await this.savedSet(userId);
    const rows = reqs.map((r) => ({
      ...r.table,
      myRequestStatus: r.status,
      saved: saved.has(r.table.id),
    }));
    await this.cache.setJson(key, rows, CacheService.TTL_MINE_SEC);
    return rows;
  }

  async toggleSave(userId: string, tableId: string) {
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
    });
    if (!table) throw new NotFoundException('Table not found');
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { savedTableIds: true },
    });
    const current = u?.savedTableIds ?? [];
    const isSaved = current.includes(tableId);
    const next = isSaved
      ? current.filter((id) => id !== tableId)
      : [...current, tableId];
    await this.prisma.user.update({
      where: { id: userId },
      data: { savedTableIds: next },
    });
    // Saved flags are overlaid live on browse; mine lists embed `saved`.
    void this.cache.invalidateUserLists(userId);
    return { saved: !isSaved };
  }

  async mineSaved(userId: string) {
    const key = this.cache.mineSavedKey(userId);
    const cached = await this.cache.getJson<
      Array<
        BrowseTableRow & {
          saved: true;
          myRequestStatus: string | null;
          myInvite: { id: string; status: string } | null;
        }
      >
    >(key);
    if (cached) return cached;

    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { savedTableIds: true },
    });
    const ids = u?.savedTableIds ?? [];
    const tables = await this.prisma.table.findMany({
      where: { id: { in: ids } },
      include: { cafe: true, host: { select: HOST_SELECT } },
      orderBy: { startAt: 'asc' },
    });
    const statusBy = await this.myStatusByTable(userId, ids);
    const inviteBy = await this.myInviteByTable(userId, ids);
    const rows = tables.map((t) => ({
      ...t,
      saved: true as const,
      myRequestStatus: statusBy.get(t.id) ?? null,
      myInvite: inviteBy.get(t.id) ?? null,
    }));
    await this.cache.setJson(key, rows, CacheService.TTL_MINE_SEC);
    return rows;
  }

  // ---------- join lifecycle ----------
  async requestJoin(userId: string, tableId: string) {
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
    });
    if (!table) throw new NotFoundException('Table not found');
    assertJoinableTable(table);
    if (table.hostId === userId) {
      throw new BadRequestException('You are the host of this table');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.codeOfConductAt) {
      throw new ForbiddenException(
        'Please accept the Community Code of Conduct in your profile first.',
      );
    }

    const existing = await this.prisma.tableJoinRequest.findUnique({
      where: { tableId_userId: { tableId, userId } },
    });
    if (
      existing &&
      existing.status !== 'DECLINED' &&
      existing.status !== 'CANCELLED'
    ) {
      throw new ConflictException(
        existing.status === 'APPROVED'
          ? 'You are already in this table'
          : 'You have already requested to join',
      );
    }
    const request = existing
      ? await this.prisma.tableJoinRequest.update({
          where: { id: existing.id },
          data: { status: 'PENDING', paymentStatus: 'PENDING' },
        })
      : await this.prisma.tableJoinRequest.create({
          data: { tableId, userId },
        });

    void this.notifications.create(
      table.hostId,
      'table.request',
      'New join request',
      `${user.username ? '@' + user.username : 'Someone'} asked to join your table.`,
      { tableId },
    );
    // Joined list embeds status; browse overlays stay live — no shared browse bust.
    void this.cache.invalidateUserLists(userId);
    return request;
  }

  private async assertHost(tableId: string, userId: string) {
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
    });
    if (!table) throw new NotFoundException('Table not found');
    if (table.hostId !== userId) {
      throw new ForbiddenException('Only the host can manage this table');
    }
    return table;
  }

  /** Host inbox: all PENDING join requests across every table this user hosts. */
  async myRequests(userId: string) {
    const tables = await this.prisma.table.findMany({
      where: { hostId: userId },
      select: {
        id: true,
        title: true,
        category: true,
        startAt: true,
        venueName: true,
      },
    });
    if (tables.length === 0) return [];
    const tableById = new Map(tables.map((t) => [t.id, t]));
    const reqs = await this.prisma.tableJoinRequest.findMany({
      where: { tableId: { in: tables.map((t) => t.id) }, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: reqs.map((r) => r.userId) } },
    });
    const userById = new Map(users.map((u) => [u.id, u]));
    return reqs.map((r) => {
      const u = userById.get(r.userId);
      return {
        ...r,
        user: u ? toPublicUser(u) : null,
        table: tableById.get(r.tableId) ?? null,
      };
    });
  }

  /** The host's pending request inbox (each with the requester's profile). */
  async listRequests(userId: string, tableId: string) {
    await this.assertHost(tableId, userId);
    const reqs = await this.prisma.tableJoinRequest.findMany({
      where: { tableId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: reqs.map((r) => r.userId) } },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return reqs.map((r) => {
      const u = byId.get(r.userId);
      return { ...r, user: u ? toPublicUser(u) : null };
    });
  }

  async approve(userId: string, tableId: string, requestId: string) {
    const table = await this.assertHost(tableId, userId);
    assertJoinableTable(table);
    const req = await this.prisma.tableJoinRequest.findUnique({
      where: { id: requestId },
    });
    if (!req || req.tableId !== tableId) {
      throw new NotFoundException('Request not found');
    }
    if (req.status !== 'PENDING') {
      throw new BadRequestException('This request was already handled');
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.table.updateMany({
        where: { id: tableId, seatsLeft: { gt: 0 } },
        data: { seatsLeft: { decrement: 1 } },
      });
      if (claimed.count === 0) throw new ConflictException('Table is full');
      await tx.tableJoinRequest.update({
        where: { id: requestId },
        data: { status: 'APPROVED' },
      });
      const fresh = await tx.table.findUnique({ where: { id: tableId } });
      if (fresh && fresh.seatsLeft <= 0) {
        await tx.table.update({
          where: { id: tableId },
          data: { status: 'FULL' },
        });
      }
    });

    void this.notifications.create(
      req.userId,
      'table.approved',
      "You're in! 🎉",
      table.pricePKR
        ? 'The host approved your request — complete payment to lock your seat.'
        : 'The host approved your request. Tap the table to open the group chat.',
      { tableId },
    );
    void this.cache.invalidateTableMutation({
      hostId: table.hostId,
      userIds: [req.userId],
    });
    return { ok: true as const };
  }

  async decline(userId: string, tableId: string, requestId: string) {
    await this.assertHost(tableId, userId);
    const req = await this.prisma.tableJoinRequest.findUnique({
      where: { id: requestId },
    });
    if (!req || req.tableId !== tableId) {
      throw new NotFoundException('Request not found');
    }
    if (req.status !== 'PENDING') {
      throw new BadRequestException('This request was already handled');
    }
    await this.prisma.tableJoinRequest.update({
      where: { id: requestId },
      data: { status: 'DECLINED' },
    });
    void this.notifications.create(
      req.userId,
      'table.declined',
      'Request declined',
      'The host couldn’t fit you in this time — plenty more tables to explore.',
      { tableId },
    );
    void this.cache.invalidateUserLists(req.userId);
    return { ok: true as const };
  }

  /** Guest cancels their own request/seat; releases a claimed seat. */
  async leave(userId: string, tableId: string) {
    const req = await this.prisma.tableJoinRequest.findUnique({
      where: { tableId_userId: { tableId, userId } },
    });
    if (!req || req.status === 'CANCELLED' || req.status === 'DECLINED') {
      throw new BadRequestException(
        'You have no active request for this table',
      );
    }
    const wasApproved = req.status === 'APPROVED';
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
      select: { hostId: true },
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.tableJoinRequest.update({
        where: { id: req.id },
        data: { status: 'CANCELLED' },
      });
      if (wasApproved) {
        const row = await tx.table.findUnique({ where: { id: tableId } });
        await tx.table.update({
          where: { id: tableId },
          data: {
            seatsLeft: { increment: 1 },
            ...(row?.status === 'FULL' ? { status: 'OPEN' as const } : {}),
          },
        });
      }
    });
    void this.cache.invalidateTableMutation({
      hostId: table?.hostId,
      userIds: [userId],
      browse: wasApproved, // seats/OPEN↔FULL only when an approved seat freed
    });
    if (!wasApproved) void this.cache.invalidateUserLists(userId);
    return { ok: true as const };
  }

  // ---------- per-table chat (host + approved guests) ----------

  private async isMember(userId: string, tableId: string): Promise<boolean> {
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
    });
    if (!table) return false;
    if (table.hostId === userId) return true;
    const req = await this.prisma.tableJoinRequest.findUnique({
      where: { tableId_userId: { tableId, userId } },
    });
    return req?.status === 'APPROVED';
  }

  /** Platform staff (admin / organizer) — above host for Moments moderation. */
  private async isStaff(userId: string): Promise<boolean> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    return u?.role === 'ADMIN' || u?.role === 'ORGANIZER';
  }

  private async canViewMedia(
    userId: string,
    tableId: string,
  ): Promise<boolean> {
    if (await this.isMember(userId, tableId)) return true;
    return this.isStaff(userId);
  }

  private async canManageMedia(
    userId: string,
    table: { hostId: string },
  ): Promise<boolean> {
    if (table.hostId === userId) return true;
    return this.isStaff(userId);
  }

  private isChatClosed(
    table: {
      chatClosedAt: Date | null;
      completedAt: Date | null;
      startAt: Date;
    },
    now = Date.now(),
  ): { closed: boolean; closesAt: Date | null } {
    const { closed, closesAt } = isTableChatClosed(table, now);
    return { closed, closesAt };
  }

  async getChat(userId: string, tableId: string) {
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
    });
    if (!table) {
      return {
        member: false,
        closed: true,
        closesAt: null,
        canClose: false,
        messages: [],
      };
    }
    const member = await this.isMember(userId, tableId);
    const { closed, closesAt } = this.isChatClosed(table);
    if (!member) {
      return {
        member: false,
        closed,
        closesAt: closesAt?.toISOString() ?? null,
        canClose: false,
        messages: [],
      };
    }
    const me = await this.prisma.user.findUnique({ where: { id: userId } });
    const blocked = new Set(me?.blockedUserIds ?? []);
    const rows = await this.prisma.groupMessage.findMany({
      where: { groupId: tableId },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.userId))] } },
      select: { id: true, username: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    const filtered = rows.filter((r) => !blocked.has(r.userId));
    const reactionMap = await this.reactions.forMessages(
      filtered.map((r) => r.id),
      userId,
    );
    const messages = filtered.map((r) => ({
      id: r.id,
      userId: r.userId,
      body: r.body,
      createdAt: r.createdAt.toISOString(),
      username: byId.get(r.userId)?.username ?? null,
      reactions: reactionMap.get(r.id) ?? [],
    }));
    return {
      member: true,
      closed,
      closesAt: closesAt?.toISOString() ?? null,
      canClose: table.hostId === userId && !closed,
      messages,
    };
  }

  async postChat(userId: string, tableId: string, body: string) {
    if (!(await this.isMember(userId, tableId))) {
      throw new ForbiddenException(
        'Only the host and approved guests can chat',
      );
    }
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
    });
    if (!table) throw new NotFoundException('Table not found');
    if (this.isChatClosed(table).closed) {
      throw new ForbiddenException('This group chat is closed');
    }
    const text = body.trim();
    if (!text) throw new BadRequestException('Message cannot be empty');
    await this.prisma.groupMessage.create({
      data: { groupId: tableId, userId, body: text.slice(0, 1000) },
    });
    return { ok: true as const };
  }

  /** Host (or admin via AdminService) closes the group chat immediately. */
  async closeChat(actorId: string, tableId: string, asAdmin = false) {
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
    });
    if (!table) throw new NotFoundException('Table not found');
    if (!asAdmin && table.hostId !== actorId) {
      throw new ForbiddenException('Only the host can close this chat');
    }
    if (table.chatClosedAt) {
      return {
        ok: true as const,
        chatClosedAt: table.chatClosedAt.toISOString(),
      };
    }
    const updated = await this.prisma.table.update({
      where: { id: tableId },
      data: { chatClosedAt: new Date() },
      select: { chatClosedAt: true },
    });
    void this.audit.log({
      actorId,
      action: 'table.chat.closed',
      targetType: 'table',
      targetId: tableId,
      meta: { asAdmin },
    });
    return {
      ok: true as const,
      chatClosedAt: updated.chatClosedAt!.toISOString(),
    };
  }

  /** Host view of approved guests (for kick UI). */
  async listParticipants(userId: string, tableId: string) {
    await this.assertHost(tableId, userId);
    const reqs = await this.prisma.tableJoinRequest.findMany({
      where: { tableId, status: 'APPROVED' },
      orderBy: { createdAt: 'asc' },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: reqs.map((r) => r.userId) } },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return reqs.map((r) => {
      const u = byId.get(r.userId);
      return {
        userId: r.userId,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        user: u ? toPublicUser(u) : null,
      };
    });
  }

  /**
   * Host removes an approved/pending guest. Cannot remove the host.
   * Admin path uses the same logic with asAdmin=true.
   */
  async removeParticipant(
    actorId: string,
    tableId: string,
    userId: string,
    asAdmin = false,
  ) {
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
    });
    if (!table) throw new NotFoundException('Table not found');
    if (!asAdmin && table.hostId !== actorId) {
      throw new ForbiddenException('Only the host can remove participants');
    }
    if (userId === table.hostId) {
      throw new BadRequestException('Cannot remove the host from the table');
    }

    await this.prisma.$transaction(async (tx) => {
      const req = await tx.tableJoinRequest.findUnique({
        where: { tableId_userId: { tableId, userId } },
        select: { id: true, status: true },
      });

      if (!req || req.status === 'CANCELLED') {
        throw new BadRequestException(
          'No active join request found for this participant',
        );
      }

      const wasApproved = req.status === 'APPROVED';

      await tx.tableJoinRequest.update({
        where: { id: req.id },
        data: { status: 'CANCELLED' },
      });

      if (wasApproved) {
        const updated = await tx.table.update({
          where: { id: tableId },
          data: { seatsLeft: { increment: 1 } },
          select: { status: true, seatsLeft: true },
        });
        if (updated.status === 'FULL' && updated.seatsLeft > 0) {
          await tx.table.update({
            where: { id: tableId },
            data: { status: 'OPEN' },
          });
        }
      }
    });

    void this.audit.log({
      actorId,
      action: 'table.participant.removed',
      targetType: 'table',
      targetId: tableId,
      meta: { userId, asAdmin },
    });

    void this.cache.invalidateTableMutation({
      hostId: table.hostId,
      userIds: [userId],
    });

    return { ok: true as const };
  }
}
