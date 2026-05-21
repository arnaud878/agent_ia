import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { AppDbService } from '../../common/db/app-db.service';
import { ConversationAttachmentsService } from './conversation-attachments.service';

export type ConversationRow = {
  id: string;
  displayKey: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UiMessageRow = {
  id: string;
  role: 'user' | 'assistant';
  text: string | null;
  html: string | null;
  durationMs: number | null;
  requeteSQL: string | null;
  resultatSQL: string | null;
  createdAt: string;
};

const LIST_CONVERSATIONS_MAX = 2000;
const LOAD_MESSAGES_MAX = 20_000;

@Injectable()
export class ConversationsService {
  private readonly log = new Logger(ConversationsService.name);

  constructor(
    private readonly appDb: AppDbService,
    private readonly attachments: ConversationAttachmentsService,
  ) {}

  private async nextUniqueDisplayKey(): Promise<string> {
    for (let i = 0; i < 8; i++) {
      const raw = randomBytes(8).toString('base64url').replace(/[^a-zA-Z0-9]/g, '');
      const k = (raw.length >= 10 ? raw : randomUUID().replace(/-/g, '')).slice(0, 10);
      const exists = await this.appDb.db
        .selectFrom('bi_conversations')
        .select('id')
        .where('display_key', '=', k)
        .executeTakeFirst();
      if (!exists) return k;
    }
    return randomBytes(10).toString('hex').slice(0, 16);
  }

  async listForUser(userId: string): Promise<ConversationRow[]> {
    const rows = await this.appDb.executeRaw<{
      id: string;
      displayKey: string;
      title: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>(
      `SELECT
          c.id,
          c.display_key AS "displayKey",
          c.title,
          c.created_at AS "createdAt",
          c.updated_at AS "updatedAt"
        FROM public.bi_conversations c
        WHERE c.user_id = $1
        ORDER BY
          (SELECT max(m.created_at)
           FROM public.bi_conversation_messages m
           WHERE m.conversation_id = c.id) DESC NULLS LAST,
          c.updated_at DESC
        LIMIT ${LIST_CONVERSATIONS_MAX}`,
      [userId],
    );
    return rows.rows.map((r) => ({
      ...r,
      createdAt: String(r.createdAt),
      updatedAt: String(r.updatedAt),
    }));
  }

  async upsert(
    userId: string,
    body: { id?: string; title?: string | null },
  ): Promise<ConversationRow> {
    const id = body.id && body.id.length > 0 ? body.id : randomUUID();
    const title =
      body.title === undefined
        ? null
        : body.title === null
          ? null
          : String(body.title).trim() || null;

    const existing = await this.appDb.db
      .selectFrom('bi_conversations')
      .select('user_id')
      .where('id', '=', id)
      .executeTakeFirst();

    if (existing !== undefined && String(existing.user_id) !== userId) {
      throw new ConflictException("Conversation d'un autre utilisateur");
    }

    if (existing === undefined) {
      const displayKey = await this.nextUniqueDisplayKey();
      const r = await this.appDb.db
        .insertInto('bi_conversations')
        .values({
          id,
          user_id: userId,
          title,
          display_key: displayKey,
          created_at: sql`now()`,
          updated_at: sql`now()`,
        })
        .returning([
          'id',
          'display_key as displayKey',
          'title',
          'created_at as createdAt',
          'updated_at as updatedAt',
        ])
        .executeTakeFirst();
      if (!r) throw new ConflictException('Création conversation');
      return {
        id: String(r.id),
        displayKey: String(r.displayKey),
        title: r.title ?? null,
        createdAt: String(r.createdAt),
        updatedAt: String(r.updatedAt),
      };
    }

    const r = await this.appDb.db
      .updateTable('bi_conversations')
      .set({
        title: title !== null ? title : sql`title`,
        updated_at: sql`now()`,
      })
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .returning([
        'id',
        'display_key as displayKey',
        'title',
        'created_at as createdAt',
        'updated_at as updatedAt',
      ])
      .executeTakeFirst();
    if (!r) throw new ForbiddenException();
    return {
      id: String(r.id),
      displayKey: String(r.displayKey),
      title: r.title ?? null,
      createdAt: String(r.createdAt),
      updatedAt: String(r.updatedAt),
    };
  }

  async ensureOwner(
    userId: string,
    conversationId: string,
  ): Promise<ConversationRow> {
    const r = await this.appDb.db
      .selectFrom('bi_conversations')
      .select([
        'id',
        'display_key as displayKey',
        'title',
        'created_at as createdAt',
        'updated_at as updatedAt',
      ])
      .where('id', '=', conversationId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!r) throw new NotFoundException();
    return {
      id: String(r.id),
      displayKey: String(r.displayKey),
      title: r.title ?? null,
      createdAt: String(r.createdAt),
      updatedAt: String(r.updatedAt),
    };
  }

  async patch(
    userId: string,
    conversationId: string,
    body: { title?: string | null },
  ): Promise<ConversationRow> {
    const title =
      Object.keys(body).length === 0
        ? undefined
        : body.title === null
          ? null
          : (body.title ?? '').trim() || null;

    const setClause =
      title === undefined
        ? { updated_at: sql`now()` as unknown as Date }
        : { title, updated_at: sql`now()` as unknown as Date };

    const r = await this.appDb.db
      .updateTable('bi_conversations')
      .set(setClause)
      .where('id', '=', conversationId)
      .where('user_id', '=', userId)
      .returning([
        'id',
        'display_key as displayKey',
        'title',
        'created_at as createdAt',
        'updated_at as updatedAt',
      ])
      .executeTakeFirst();
    if (!r) throw new NotFoundException();
    return {
      id: String(r.id),
      displayKey: String(r.displayKey),
      title: r.title ?? null,
      createdAt: String(r.createdAt),
      updatedAt: String(r.updatedAt),
    };
  }

  async loadMessagesForOwner(
    userId: string,
    conversationId: string,
  ): Promise<UiMessageRow[]> {
    await this.ensureOwner(userId, conversationId);
    const rows = await this.appDb.db
      .selectFrom('bi_conversation_messages')
      .select([
        'id',
        'role',
        'body_text as text',
        'body_html as html',
        'duration_ms as durationMs',
        'requete_sql as requeteSQL',
        'resultat_sql as resultatSQL',
        'created_at as createdAt',
      ])
      .where('conversation_id', '=', conversationId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .limit(LOAD_MESSAGES_MAX)
      .execute();

    return rows.map((r) => ({
      id: String(r.id),
      role: r.role as 'user' | 'assistant',
      text: r.text ?? null,
      html: r.html ?? null,
      durationMs: r.durationMs === null ? null : Number(r.durationMs),
      requeteSQL: r.requeteSQL ?? null,
      resultatSQL: r.resultatSQL ?? null,
      createdAt: String(r.createdAt),
    }));
  }

  async appendUiMessage(
    userId: string,
    conversationId: string,
    body: {
      role: 'user' | 'assistant';
      text?: string | null;
      html?: string | null;
      durationMs?: number | null;
      requeteSQL?: string | null;
      resultatSQL?: string | null;
    },
  ): Promise<{ id: string }> {
    await this.ensureOwner(userId, conversationId);
    const t = body.text?.trim() || null;
    const h = body.html?.trim() || null;
    if (body.role === 'user' && !t) {
      throw new BadRequestException('Message utilisateur sans texte');
    }
    if (body.role === 'assistant' && !t && !h) {
      throw new BadRequestException('Message assistant sans contenu');
    }
    const dur =
      body.durationMs === undefined || body.durationMs === null
        ? null
        : Math.min(1_000_000, Math.max(0, body.durationMs));

    const row = await this.appDb.db
      .insertInto('bi_conversation_messages')
      .values({
        conversation_id: conversationId,
        role: body.role,
        body_text: t,
        body_html: h,
        duration_ms: dur,
        requete_sql: body.requeteSQL?.trim() || null,
        resultat_sql: body.resultatSQL?.trim() || null,
      })
      .returning('id')
      .executeTakeFirst();

    const id = row?.id;
    if (!id) throw new BadRequestException('Enregistrement message');

    try {
      await this.appDb.db
        .updateTable('bi_conversations')
        .set({ updated_at: sql`now()` })
        .where('id', '=', conversationId)
        .execute();
    } catch (e) {
      this.log.warn('touch conversation: %s', (e as Error).message);
    }
    return { id: String(id) };
  }

  async remove(userId: string, conversationId: string): Promise<void> {
    await this.ensureOwner(userId, conversationId);
    await this.attachments.purgeFilesForConversation(conversationId).catch(() => {});
    try {
      await this.appDb.db
        .deleteFrom('n8n_chat_histories_v6')
        .where('session_id', '=', conversationId)
        .execute();
    } catch (e) {
      this.log.warn('Suppression historique agent: %s', (e as Error).message);
    }
    try {
      await this.appDb.db
        .deleteFrom('bi_conversations')
        .where('id', '=', conversationId)
        .where('user_id', '=', userId)
        .execute();
    } catch (e) {
      this.log.warn('Suppression conversation: %s', (e as Error).message);
    }
  }
}
