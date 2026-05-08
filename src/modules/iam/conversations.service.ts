import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import type { QueryResult } from 'pg';
import { SchemaService } from '../bi/services/schema.service';

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

/** Nombre max de fils / messages (cohérent avec n8n + UI) — évite les OOM, à ajuster côté besoin. */
const LIST_CONVERSATIONS_MAX = 2000;
const LOAD_MESSAGES_MAX = 20_000;

@Injectable()
export class ConversationsService {
  private readonly log = new Logger(ConversationsService.name);

  constructor(private readonly schema: SchemaService) {}

  private async nextUniqueDisplayKey(): Promise<string> {
    for (let i = 0; i < 8; i++) {
      const raw = randomBytes(8).toString('base64url').replace(/[^a-zA-Z0-9]/g, '');
      const k = (raw.length >= 10 ? raw : randomUUID().replace(/-/g, '')).slice(0, 10);
      const exists = (await this.schema.executeAppQuery(
        `SELECT 1 AS o FROM public.bi_conversations WHERE display_key = $1`,
        [k],
      )) as QueryResult<{ o: number }>;
      if (!exists.rows?.length) {
        return k;
      }
    }
    return randomBytes(10).toString('hex').slice(0, 16);
  }

  async listForUser(userId: string): Promise<ConversationRow[]> {
    const q = `SELECT
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
      LIMIT ${LIST_CONVERSATIONS_MAX}`;
    const res = (await this.schema.executeAppQuery(q, [userId])) as QueryResult<
      ConversationRow
    >;
    return (res.rows ?? []) as unknown as ConversationRow[];
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

    const existing = await this.schema.executeAppQuery(
      `SELECT user_id AS "userId" FROM public.bi_conversations WHERE id = $1`,
      [id],
    );
    const row0 = (existing.rows[0] as { userId: string } | undefined)?.userId;
    if (row0 !== undefined && row0 !== userId) {
      throw new ConflictException("Conversation d'un autre utilisateur");
    }

    if (row0 === undefined) {
      const displayKey = await this.nextUniqueDisplayKey();
      const ins = (await this.schema.executeAppQuery(
        `INSERT INTO public.bi_conversations
          (id, user_id, title, display_key, created_at, updated_at)
         VALUES ($1, $2, $3, $4, now(), now())
         RETURNING
           id, display_key AS "displayKey", title,
           created_at AS "createdAt", updated_at AS "updatedAt"`,
        [id, userId, title, displayKey],
      )) as QueryResult<ConversationRow>;
      const r = ins.rows[0] as unknown as ConversationRow;
      if (!r) {
        throw new ConflictException('Création conversation');
      }
      return r;
    }

    const upd = (await this.schema.executeAppQuery(
      `UPDATE public.bi_conversations
       SET
         title = COALESCE($2, title),
         updated_at = now()
       WHERE id = $1 AND user_id = $3
       RETURNING
         id, display_key AS "displayKey", title,
         created_at AS "createdAt", updated_at AS "updatedAt"`,
      [id, title, userId],
    )) as QueryResult<ConversationRow>;
    const r = upd.rows[0] as unknown as ConversationRow;
    if (!r) {
      throw new ForbiddenException();
    }
    return r;
  }

  async ensureOwner(
    userId: string,
    conversationId: string,
  ): Promise<ConversationRow> {
    const res = (await this.schema.executeAppQuery(
      `SELECT
         id, display_key AS "displayKey", title,
         created_at AS "createdAt", updated_at AS "updatedAt"
       FROM public.bi_conversations
       WHERE id = $1 AND user_id = $2`,
      [conversationId, userId],
    )) as QueryResult<ConversationRow>;
    const r = (res.rows[0] as unknown as ConversationRow | undefined) ?? null;
    if (!r) {
      throw new NotFoundException();
    }
    return r;
  }

  async patch(
    userId: string,
    conversationId: string,
    body: { title?: string | null },
  ): Promise<ConversationRow> {
    if (Object.keys(body).length === 0) {
      const touch = (await this.schema.executeAppQuery(
        `UPDATE public.bi_conversations
         SET updated_at = now()
         WHERE id = $1 AND user_id = $2
         RETURNING
           id, display_key AS "displayKey", title,
           created_at AS "createdAt", updated_at AS "updatedAt"`,
        [conversationId, userId],
      )) as QueryResult<ConversationRow>;
      const r = touch.rows[0] as unknown as ConversationRow;
      if (!r) {
        throw new NotFoundException();
      }
      return r;
    }
    const title = body.title === null ? null : (body.title ?? '').trim() || null;
    const res = (await this.schema.executeAppQuery(
      `UPDATE public.bi_conversations
       SET
         title = $3,
         updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING
         id, display_key AS "displayKey", title,
         created_at AS "createdAt", updated_at AS "updatedAt"`,
      [conversationId, userId, title],
    )) as QueryResult<ConversationRow>;
    const r = res.rows[0] as unknown as ConversationRow;
    if (!r) {
      throw new NotFoundException();
    }
    return r;
  }

  async loadMessagesForOwner(
    userId: string,
    conversationId: string,
  ): Promise<UiMessageRow[]> {
    await this.ensureOwner(userId, conversationId);
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
      ORDER BY created_at ASC, id ASC
      LIMIT ${LOAD_MESSAGES_MAX}`;
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
    })) as UiMessageRow[];
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

    const rSql = body.requeteSQL?.trim() || null;
    const resSql = body.resultatSQL?.trim() || null;

    const ins = (await this.schema.executeAppQuery(
      `INSERT INTO public.bi_conversation_messages
         (conversation_id, role, body_text, body_html, duration_ms, requete_sql, resultat_sql)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [conversationId, body.role, t, h, dur, rSql, resSql],
    )) as QueryResult<{ id: string }>;
    const id = (ins.rows[0] as { id: string } | undefined)?.id;
    if (!id) {
      throw new BadRequestException('Enregistrement message');
    }
    try {
      await this.schema.executeAppQuery(
        `UPDATE public.bi_conversations SET updated_at = now() WHERE id = $1`,
        [conversationId],
      );
    } catch (e) {
      this.log.warn('touch conversation: %s', (e as Error).message);
    }
    return { id };
  }

  async remove(userId: string, conversationId: string): Promise<void> {
    await this.ensureOwner(userId, conversationId);
    try {
      await this.schema.executeAppQuery(
        `DELETE FROM public.n8n_chat_histories_v6
         WHERE session_id = $1`,
        [conversationId],
      );
    } catch (e) {
      this.log.warn('Suppression historique agent: %s', (e as Error).message);
    }
    try {
      await this.schema.executeAppQuery(
        `DELETE FROM public.bi_conversations WHERE id = $1 AND user_id = $2`,
        [conversationId, userId],
      );
    } catch (e) {
      this.log.warn('Suppression conversation: %s', (e as Error).message);
    }
  }
}
