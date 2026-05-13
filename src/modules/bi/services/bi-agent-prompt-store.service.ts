import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import {
  AGENT_PROMPT_DEFINITIONS,
  AGENT_PROMPT_IDS,
  type AgentPromptId,
  getAgentPromptDefinition,
} from '../agent-prompts.definitions';
import {
  bodyMatchesInstallDefault,
  getInstallDefaultPrompt,
} from '../bi-prompt-install-defaults';
import { SchemaService } from './schema.service';

@Injectable()
export class BiAgentPromptStoreService implements OnModuleInit {
  private readonly log = new Logger(BiAgentPromptStoreService.name);

  constructor(private readonly schema: SchemaService) {}

  async onModuleInit(): Promise<void> {
    await this.ensureTableAndSeed();
  }

  private async ensureTableAndSeed(): Promise<void> {
    await this.schema.executeAppQuery(`
      CREATE TABLE IF NOT EXISTS public.bi_agent_prompts (
        id text PRIMARY KEY,
        file_name text NOT NULL UNIQUE,
        label text NOT NULL,
        body text NOT NULL DEFAULT '',
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    for (const d of AGENT_PROMPT_DEFINITIONS) {
      await this.schema.executeAppQuery(
        `INSERT INTO public.bi_agent_prompts (id, file_name, label, body)
         VALUES ($1, $2, $3, '')
         ON CONFLICT (id) DO NOTHING`,
        [d.id, d.fileName, d.labelFr],
      );
    }
    for (const id of AGENT_PROMPT_IDS) {
      const r = await this.schema.executeAppQuery(
        `SELECT body FROM public.bi_agent_prompts WHERE id = $1`,
        [id],
      );
      const row = r.rows[0] as { body?: string } | undefined;
      const stored = row?.body ?? '';
      if (stored.trim().length === 0) {
        const fallback = getInstallDefaultPrompt(id);
        await this.schema.executeAppQuery(
          `UPDATE public.bi_agent_prompts
           SET body = $2, updated_at = now()
           WHERE id = $1`,
          [id, fallback],
        );
        this.log.log(`Prompt ${id}: corps vide en base → modèle d’installation écrit.`);
      }
    }
  }

  private assertPromptId(id: string): AgentPromptId {
    if (!AGENT_PROMPT_IDS.includes(id as AgentPromptId)) {
      throw new BadRequestException(`Prompt inconnu: ${id}`);
    }
    return id as AgentPromptId;
  }

  async resolvePromptBody(id: AgentPromptId): Promise<string> {
    const def = getAgentPromptDefinition(id);
    if (!def) {
      throw new Error(`Définition prompt manquante: ${id}`);
    }
    const r = await this.schema.executeAppQuery(
      `SELECT body FROM public.bi_agent_prompts WHERE id = $1`,
      [id],
    );
    const row = r.rows[0] as { body?: string } | undefined;
    const stored = row?.body ?? '';
    if (stored.trim().length > 0) {
      return stored;
    }
    const fallback = getInstallDefaultPrompt(id);
    this.log.warn(
      `Prompt ${id}: corps DB vide à l’exécution — repli modèle d’installation (vérifiez la base).`,
    );
    return fallback;
  }

  async listPromptsWithSource(): Promise<
    Array<{
      id: AgentPromptId;
      fileName: string;
      labelFr: string;
      labelEn: string;
      isCustomized: boolean;
      variables: Array<{
        token: string;
        descriptionFr: string;
        descriptionEn: string;
      }>;
    }>
  > {
    const r = await this.schema.executeAppQuery(
      `SELECT id, body FROM public.bi_agent_prompts WHERE id = ANY($1::text[])`,
      [Array.from(AGENT_PROMPT_IDS)],
    );
    const byId = new Map<string, string>();
    for (const row of r.rows as { id: string; body: string }[]) {
      byId.set(row.id, row.body ?? '');
    }
    return AGENT_PROMPT_DEFINITIONS.map((d) => {
      const stored = byId.get(d.id) ?? '';
      return {
        id: d.id,
        fileName: d.fileName,
        labelFr: d.labelFr,
        labelEn: d.labelEn,
        variables: d.placeholders.map((p) => ({
          token: p.token,
          descriptionFr: p.descriptionFr,
          descriptionEn: p.descriptionEn,
        })),
        isCustomized: !bodyMatchesInstallDefault(d.id, stored),
      };
    });
  }

  async getPromptDetail(id: string) {
    const pid = this.assertPromptId(id);
    const def = getAgentPromptDefinition(pid)!;
    const r = await this.schema.executeAppQuery(
      `SELECT body, updated_at FROM public.bi_agent_prompts WHERE id = $1`,
      [pid],
    );
    const row = r.rows[0] as
      | { body: string; updated_at: Date }
      | undefined;
    const storedBody = row?.body ?? '';
    const defaultBody = getInstallDefaultPrompt(pid);
    const effectiveBody =
      storedBody.trim().length > 0 ? storedBody : defaultBody;
    return {
      id: pid,
      fileName: def.fileName,
      labelFr: def.labelFr,
      labelEn: def.labelEn,
      variables: def.placeholders.map((p) => ({
        token: p.token,
        descriptionFr: p.descriptionFr,
        descriptionEn: p.descriptionEn,
      })),
      storedBody,
      defaultBody,
      effectiveBody,
      isCustomized: !bodyMatchesInstallDefault(pid, storedBody),
      updatedAt: row?.updated_at?.toISOString?.() ?? null,
    };
  }

  /**
   * Corps null, absent ou vide après trim → réinitialise au modèle d’installation (une seule source hors base).
   */
  async setPromptBody(id: string, body: string | null): Promise<void> {
    const pid = this.assertPromptId(id);
    const def = getAgentPromptDefinition(pid)!;
    const normalized =
      body == null || body.trim().length === 0
        ? getInstallDefaultPrompt(pid)
        : body;
    await this.schema.executeAppQuery(
      `INSERT INTO public.bi_agent_prompts (id, file_name, label, body, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (id) DO UPDATE SET
         body = EXCLUDED.body,
         updated_at = now()`,
      [pid, def.fileName, def.labelFr, normalized],
    );
  }
}
