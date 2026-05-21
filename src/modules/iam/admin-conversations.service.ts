import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AppDbService } from '../../common/db/app-db.service';

export type AdminConversationRow = {
  id: string;
  displayKey: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  userEmail: string;
  userId: string;
  messageCount: number;
};

export type AdminMessageRow = {
  id: string;
  role: 'user' | 'assistant';
  text: string | null;
  html: string | null;
  durationMs: number | null;
  requeteSQL: string | null;
  resultatSQL: string | null;
  createdAt: string;
  conversationId: string;
  displayKey: string;
  userEmail: string;
};

export type TurnRow = {
  userMsgId: string;
  userText: string | null;
  userCreatedAt: string;
  aiMsgId: string | null;
  aiText: string | null;
  aiHtml: string | null;
  durationMs: number | null;
  requeteSQL: string | null;
  resultatSQL: string | null;
  aiCreatedAt: string | null;
  conversationId: string;
  displayKey: string;
  title: string | null;
  userEmail: string;
};

export type PaginatedResult<T> = {
  rows: T[];
  total: number;
  page: number;
  limit: number;
};

const MAX_PAGE_LIMIT = 200;

@Injectable()
export class AdminConversationsService {
  private readonly log = new Logger(AdminConversationsService.name);

  constructor(private readonly appDb: AppDbService) {}

  async listConversations(params: {
    page?: number;
    limit?: number;
    search?: string;
    userId?: string;
  }): Promise<PaginatedResult<AdminConversationRow>> {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, params.limit ?? 50));
    const offset = (page - 1) * limit;

    let baseQuery = this.appDb.db
      .selectFrom('bi_conversations as c')
      .innerJoin('app_users as u', 'u.id', 'c.user_id');

    if (params.search) {
      const term = `%${params.search}%`;
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          eb('c.title', 'ilike', term),
          eb('u.email', 'ilike', term),
          eb('c.display_key', 'ilike', term),
        ]),
      );
    }
    if (params.userId) {
      baseQuery = baseQuery.where('c.user_id', '=', params.userId);
    }

    const countRes = await baseQuery
      .select((eb) => eb.fn.countAll<string>().as('total'))
      .executeTakeFirst();
    const total = Number(countRes?.total ?? 0);

    const rows = await baseQuery
      .select([
        'c.id',
        'c.display_key as displayKey',
        'c.title',
        'c.created_at as createdAt',
        'c.updated_at as updatedAt',
        'u.email as userEmail',
        'u.id as userId',
      ])
      .select((eb) =>
        eb
          .selectFrom('bi_conversation_messages as m')
          .select(eb.fn.countAll<string>().as('cnt'))
          .whereRef('m.conversation_id', '=', 'c.id')
          .as('messageCount'),
      )
      .orderBy('c.updated_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    return {
      rows: rows.map((r) => ({
        id: String(r.id),
        displayKey: String(r.displayKey),
        title: r.title ?? null,
        createdAt: String(r.createdAt),
        updatedAt: String(r.updatedAt),
        userEmail: String(r.userEmail),
        userId: String(r.userId),
        messageCount: Number(r.messageCount ?? 0),
      })),
      total,
      page,
      limit,
    };
  }

  async getMessages(conversationId: string): Promise<AdminMessageRow[]> {
    const exists = await this.appDb.db
      .selectFrom('bi_conversations')
      .select('id')
      .where('id', '=', conversationId)
      .executeTakeFirst();
    if (!exists) throw new NotFoundException('Conversation introuvable');

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
      conversationId,
      displayKey: '',
      userEmail: '',
    }));
  }

  async listAllMessages(params: {
    page?: number;
    limit?: number;
    search?: string;
    role?: 'user' | 'assistant';
  }): Promise<PaginatedResult<AdminMessageRow>> {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, params.limit ?? 50));
    const offset = (page - 1) * limit;

    let baseQuery = this.appDb.db
      .selectFrom('bi_conversation_messages as m')
      .innerJoin('bi_conversations as c', 'c.id', 'm.conversation_id')
      .innerJoin('app_users as u', 'u.id', 'c.user_id');

    if (params.search) {
      const term = `%${params.search}%`;
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          eb('m.body_text', 'ilike', term),
          eb('m.requete_sql', 'ilike', term),
          eb('m.resultat_sql', 'ilike', term),
          eb('u.email', 'ilike', term),
          eb('c.display_key', 'ilike', term),
        ]),
      );
    }
    if (params.role) {
      baseQuery = baseQuery.where('m.role', '=', params.role);
    }

    const countRes = await baseQuery
      .select((eb) => eb.fn.countAll<string>().as('total'))
      .executeTakeFirst();
    const total = Number(countRes?.total ?? 0);

    const rows = await baseQuery
      .select([
        'm.id',
        'm.role',
        'm.body_text as text',
        'm.body_html as html',
        'm.duration_ms as durationMs',
        'm.requete_sql as requeteSQL',
        'm.resultat_sql as resultatSQL',
        'm.created_at as createdAt',
        'c.id as conversationId',
        'c.display_key as displayKey',
        'u.email as userEmail',
      ])
      .orderBy('m.created_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    return {
      rows: rows.map((r) => ({
        id: String(r.id),
        role: r.role as 'user' | 'assistant',
        text: r.text ?? null,
        html: r.html ?? null,
        durationMs: r.durationMs === null ? null : Number(r.durationMs),
        requeteSQL: r.requeteSQL ?? null,
        resultatSQL: r.resultatSQL ?? null,
        createdAt: String(r.createdAt),
        conversationId: String(r.conversationId),
        displayKey: String(r.displayKey),
        userEmail: String(r.userEmail),
      })),
      total,
      page,
      limit,
    };
  }

  async listTurns(params: {
    page?: number;
    limit?: number;
    search?: string;
  }): Promise<PaginatedResult<TurnRow>> {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, params.limit ?? 50));
    const offset = (page - 1) * limit;

    const values: unknown[] = [];
    let extraWhere = '';

    if (params.search) {
      values.push(`%${params.search}%`);
      extraWhere = `AND (u.email ILIKE $1 OR um.body_text ILIKE $1 OR c.display_key ILIKE $1 OR c.title ILIKE $1)`;
    }

    const countRes = await this.appDb.executeRaw<{ total: string }>(
      `SELECT COUNT(*) AS total
       FROM public.bi_conversation_messages um
       JOIN public.bi_conversations c ON c.id = um.conversation_id
       JOIN public.app_users u ON u.id = c.user_id
       WHERE um.role = 'user' ${extraWhere}`,
      values,
    );
    const total = Number(countRes.rows[0]?.total ?? 0);
    const limitIdx = values.length + 1;
    const offsetIdx = values.length + 2;

    const res = await this.appDb.executeRaw<Record<string, unknown>>(
      `SELECT
          um.id AS "userMsgId",
          um.body_text AS "userText",
          um.created_at AS "userCreatedAt",
          am.id AS "aiMsgId",
          am.body_text AS "aiText",
          am.body_html AS "aiHtml",
          am.duration_ms AS "durationMs",
          am.requete_sql AS "requeteSQL",
          am.resultat_sql AS "resultatSQL",
          am.created_at AS "aiCreatedAt",
          c.id AS "conversationId",
          c.display_key AS "displayKey",
          c.title,
          u.email AS "userEmail"
        FROM public.bi_conversation_messages um
        JOIN public.bi_conversations c ON c.id = um.conversation_id
        JOIN public.app_users u ON u.id = c.user_id
        LEFT JOIN LATERAL (
          SELECT id, body_text, body_html, duration_ms, requete_sql, resultat_sql, created_at
          FROM public.bi_conversation_messages a2
          WHERE a2.conversation_id = um.conversation_id
            AND a2.role = 'assistant'
            AND a2.created_at >= um.created_at
          ORDER BY a2.created_at ASC
          LIMIT 1
        ) am ON true
        WHERE um.role = 'user' ${extraWhere}
        ORDER BY um.created_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...values, limit, offset],
    );

    return {
      rows: res.rows.map((r) => ({
        userMsgId: r['userMsgId'] as string,
        userText: (r['userText'] as string | null) ?? null,
        userCreatedAt: String(r['userCreatedAt'] ?? ''),
        aiMsgId: (r['aiMsgId'] as string | null) ?? null,
        aiText: (r['aiText'] as string | null) ?? null,
        aiHtml: (r['aiHtml'] as string | null) ?? null,
        durationMs: r['durationMs'] == null ? null : Number(r['durationMs']),
        requeteSQL: (r['requeteSQL'] as string | null) ?? null,
        resultatSQL: (r['resultatSQL'] as string | null) ?? null,
        aiCreatedAt: r['aiCreatedAt'] ? String(r['aiCreatedAt']) : null,
        conversationId: r['conversationId'] as string,
        displayKey: r['displayKey'] as string,
        title: (r['title'] as string | null) ?? null,
        userEmail: r['userEmail'] as string,
      })),
      total,
      page,
      limit,
    };
  }

  async removeConversation(conversationId: string): Promise<void> {
    try {
      await this.appDb.db
        .deleteFrom('n8n_chat_histories_v6')
        .where('session_id', '=', conversationId)
        .execute();
    } catch (e) {
      this.log.warn('Suppression historique agent: %s', (e as Error).message);
    }
    const res = await this.appDb.db
      .deleteFrom('bi_conversations')
      .where('id', '=', conversationId)
      .returning('id')
      .executeTakeFirst();
    if (!res) throw new NotFoundException('Conversation introuvable');
  }
}
