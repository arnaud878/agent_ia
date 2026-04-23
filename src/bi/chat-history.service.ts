import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { QueryResult } from 'pg';
import { SchemaService } from './schema.service';

export type HistoryRow = { role: 'user' | 'assistant'; text: string };

@Injectable()
export class ChatHistoryService {
  private readonly log = new Logger(ChatHistoryService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly schema: SchemaService,
  ) {}

  getMaxMessages(): number {
    const n = this.config.get<string>('CHAT_HISTORY_MAX_MESSAGES');
    const p = n ? parseInt(n, 10) : 4;
    if (!Number.isFinite(p) || p < 0) {
      return 4;
    }
    return Math.min(50, p);
  }

  /**
   * Derniers messages (ordre chrono) pour alimenter l’agent.
   * Chaque entrée = une ligne user ou assistant.
   */
  async loadForSession(
    sessionId: string,
    limit: number,
  ): Promise<HistoryRow[]> {
    if (limit <= 0) {
      return [];
    }
    const q = `SELECT message
      FROM public.n8n_chat_histories_v6
      WHERE session_id = $1
      ORDER BY id DESC
      LIMIT $2`;
    let res: QueryResult<{ message: unknown }>;
    try {
      res = await this.schema.executeQuery(q, [sessionId, limit]) as QueryResult<{
        message: unknown;
      }>;
    } catch (e) {
      this.log.warn('Historique indisponible: %s', (e as Error).message);
      return [];
    }
    const raw = (res.rows ?? [])
      .map((r) => r.message)
      .reverse()
      .map((m) => this.parseMessage(m))
      .filter((x): x is HistoryRow => x !== null);
    return raw;
  }

  async append(
    sessionId: string,
    message: { role: 'user' | 'assistant'; text: string },
  ): Promise<void> {
    const q = `INSERT INTO public.n8n_chat_histories_v6 (session_id, message)
      VALUES ($1, $2::jsonb)`;
    const payload = {
      role: message.role,
      text: message.text,
    };
    try {
      await this.schema.executeQuery(q, [sessionId, JSON.stringify(payload)]);
    } catch (e) {
      this.log.warn('Enregistrement historique échoué: %s', (e as Error).message);
    }
  }

  private parseMessage(message: unknown): HistoryRow | null {
    if (!message || typeof message !== 'object') {
      return null;
    }
    const m = message as Record<string, unknown>;
    const role = m['role'];
    const text = m['text'];
    if (role !== 'user' && role !== 'assistant') {
      return null;
    }
    if (typeof text !== 'string' || !text.trim()) {
      return null;
    }
    return { role, text: text.trim() };
  }
}
