import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppDbService } from '../../../common/db/app-db.service';

export type HistoryRow = { role: 'user' | 'assistant'; text: string };

@Injectable()
export class ChatHistoryService {
  private readonly log = new Logger(ChatHistoryService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly appDb: AppDbService,
  ) {}

  getMaxMessages(): number {
    const n = this.config.get<string>('CHAT_HISTORY_MAX_MESSAGES');
    const p = n ? parseInt(n, 10) : 4;
    if (!Number.isFinite(p) || p < 0) return 4;
    return Math.min(50, p);
  }

  async loadForSession(
    sessionId: string,
    limit: number,
  ): Promise<HistoryRow[]> {
    if (limit <= 0) return [];
    try {
      const rows = await this.appDb.db
        .selectFrom('n8n_chat_histories_v6')
        .select('message')
        .where('session_id', '=', sessionId)
        .orderBy('id', 'desc')
        .limit(limit)
        .execute();

      return rows
        .map((r) => r.message)
        .reverse()
        .map((m) => this.parseMessage(m))
        .filter((x): x is HistoryRow => x !== null);
    } catch (e) {
      this.log.warn('Historique indisponible: %s', (e as Error).message);
      return [];
    }
  }

  async append(
    sessionId: string,
    message: { role: 'user' | 'assistant'; text: string },
  ): Promise<void> {
    try {
      await this.appDb.db
        .insertInto('n8n_chat_histories_v6')
        .values({
          session_id: sessionId,
          message: JSON.parse(JSON.stringify(message)) as unknown,
        })
        .execute();
    } catch (e) {
      this.log.warn(
        'Enregistrement historique échoué: %s',
        (e as Error).message,
      );
    }
  }

  private parseMessage(message: unknown): HistoryRow | null {
    if (!message || typeof message !== 'object') return null;
    const m = message as Record<string, unknown>;
    const role = m['role'];
    const text = m['text'];
    if (role !== 'user' && role !== 'assistant') return null;
    if (typeof text !== 'string' || !text.trim()) return null;
    return { role, text: text.trim() };
  }
}
