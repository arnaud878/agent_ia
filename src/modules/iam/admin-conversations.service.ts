import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { QueryResult } from 'pg';
import { SchemaService } from '../bi/services/schema.service';

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

  constructor(private readonly schema: SchemaService) {}

  async listConversations(params: {
    page?: number;
    limit?: number;
    search?: string;
    userId?: string;
  }): Promise<PaginatedResult<AdminConversationRow>> {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, params.limit ?? 50));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (params.search) {
      conditions.push(
        `(c.title ILIKE $${idx} OR u.email ILIKE $${idx} OR c.display_key ILIKE $${idx})`,
      );
      values.push(`%${params.search}%`);
      idx++;
    }

    if (params.userId) {
      conditions.push(`c.user_id = $${idx}`);
      values.push(params.userId);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = (await this.schema.executeAppQuery(
      `SELECT COUNT(*) AS total
       FROM public.bi_conversations c
       JOIN public.app_users u ON u.id = c.user_id
       ${where}`,
      values,
    )) as QueryResult<{ total: number }>;

    const total = Number(countRes.rows[0]?.total ?? 0);

    const q = `SELECT
        c.id,
        c.display_key AS "displayKey",
        c.title,
        c.created_at AS "createdAt",
        c.updated_at AS "updatedAt",
        u.email AS "userEmail",
        u.id AS "userId",
        (SELECT COUNT(*) FROM public.bi_conversation_messages m WHERE m.conversation_id = c.id) AS "messageCount"
      FROM public.bi_conversations c
      JOIN public.app_users u ON u.id = c.user_id
      ${where}
      ORDER BY c.updated_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}`;

    const res = (await this.schema.executeAppQuery(q, [
      ...values,
      limit,
      offset,
    ])) as QueryResult<AdminConversationRow>;

    return {
      rows: (res.rows ?? []) as unknown as AdminConversationRow[],
      total,
      page,
      limit,
    };
  }

  async getMessages(conversationId: string): Promise<AdminMessageRow[]> {
    const exists = (await this.schema.executeAppQuery(
      `SELECT 1 AS o FROM public.bi_conversations WHERE id = $1`,
      [conversationId],
    )) as QueryResult<{ o: number }>;

    if (!exists.rows?.length) {
      throw new NotFoundException('Conversation introuvable');
    }

    const q = `SELECT
        id,
        role,
        body_text AS "text",
        body_html AS "html",
        duration_ms AS "durationMs",
        requete_sql AS "requeteSQL",
        resultat_sql AS "resultatSQL",
        created_at AS "createdAt"
      FROM public.bi_conversation_messages
      WHERE conversation_id = $1
      ORDER BY created_at ASC, id ASC`;
    const res = (await this.schema.executeAppQuery(q, [
      conversationId,
    ])) as QueryResult<Record<string, unknown>>;

    return (res.rows ?? []).map((r) => ({
      id: r['id'] as string,
      role: r['role'] as 'user' | 'assistant',
      text: (r['text'] as string | null) ?? null,
      html: (r['html'] as string | null) ?? null,
      durationMs:
        r['durationMs'] === null || r['durationMs'] === undefined
          ? null
          : Number(r['durationMs']),
      requeteSQL: (r['requeteSQL'] as string | null) ?? null,
      resultatSQL: (r['resultatSQL'] as string | null) ?? null,
      createdAt: String(r['createdAt'] ?? ''),
    })) as AdminMessageRow[];
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

    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (params.search) {
      conditions.push(
        `(m.body_text ILIKE $${idx} OR m.requete_sql ILIKE $${idx} OR m.resultat_sql ILIKE $${idx} OR u.email ILIKE $${idx} OR c.display_key ILIKE $${idx})`,
      );
      values.push(`%${params.search}%`);
      idx++;
    }

    if (params.role) {
      conditions.push(`m.role = $${idx}`);
      values.push(params.role);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = (await this.schema.executeAppQuery(
      `SELECT COUNT(*) AS total
       FROM public.bi_conversation_messages m
       JOIN public.bi_conversations c ON c.id = m.conversation_id
       JOIN public.app_users u ON u.id = c.user_id
       ${where}`,
      values,
    )) as QueryResult<{ total: number }>;

    const total = Number(countRes.rows[0]?.total ?? 0);

    const q = `SELECT
        m.id,
        m.role,
        m.body_text AS "text",
        m.body_html AS "html",
        m.duration_ms AS "durationMs",
        m.requete_sql AS "requeteSQL",
        m.resultat_sql AS "resultatSQL",
        m.created_at AS "createdAt",
        c.id AS "conversationId",
        c.display_key AS "displayKey",
        u.email AS "userEmail"
      FROM public.bi_conversation_messages m
      JOIN public.bi_conversations c ON c.id = m.conversation_id
      JOIN public.app_users u ON u.id = c.user_id
      ${where}
      ORDER BY m.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}`;

    const res = (await this.schema.executeAppQuery(q, [
      ...values,
      limit,
      offset,
    ])) as QueryResult<Record<string, unknown>>;

    return {
      rows: (res.rows ?? []).map((r) => ({
        id: r['id'] as string,
        role: r['role'] as 'user' | 'assistant',
        text: (r['text'] as string | null) ?? null,
        html: (r['html'] as string | null) ?? null,
        durationMs:
          r['durationMs'] === null || r['durationMs'] === undefined
            ? null
            : Number(r['durationMs']),
        requeteSQL: (r['requeteSQL'] as string | null) ?? null,
        resultatSQL: (r['resultatSQL'] as string | null) ?? null,
        createdAt: String(r['createdAt'] ?? ''),
        conversationId: r['conversationId'] as string,
        displayKey: r['displayKey'] as string,
        userEmail: r['userEmail'] as string,
      })) as AdminMessageRow[],
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

    const countRes = (await this.schema.executeAppQuery(
      `SELECT COUNT(*) AS total
       FROM public.bi_conversation_messages um
       JOIN public.bi_conversations c ON c.id = um.conversation_id
       JOIN public.app_users u ON u.id = c.user_id
       WHERE um.role = 'user' ${extraWhere}`,
      values,
    )) as QueryResult<{ total: string }>;

    const total = Number(countRes.rows[0]?.total ?? 0);
    const limitIdx = values.length + 1;
    const offsetIdx = values.length + 2;

    const q = `SELECT
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
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

    const res = (await this.schema.executeAppQuery(q, [
      ...values,
      limit,
      offset,
    ])) as QueryResult<Record<string, unknown>>;

    return {
      rows: (res.rows ?? []).map((r) => ({
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
      })) as TurnRow[],
      total,
      page,
      limit,
    };
  }

  async removeConversation(conversationId: string): Promise<void> {
    try {
      await this.schema.executeAppQuery(
        `DELETE FROM public.n8n_chat_histories_v6 WHERE session_id = $1`,
        [conversationId],
      );
    } catch (e) {
      this.log.warn('Suppression historique agent: %s', (e as Error).message);
    }
    try {
      const res = (await this.schema.executeAppQuery(
        `DELETE FROM public.bi_conversations WHERE id = $1 RETURNING id`,
        [conversationId],
      )) as QueryResult<{ id: string }>;
      if (!res.rows?.length) {
        throw new NotFoundException('Conversation introuvable');
      }
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      this.log.warn('Suppression conversation: %s', (e as Error).message);
    }
  }
}
