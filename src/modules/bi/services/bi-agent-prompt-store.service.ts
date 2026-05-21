import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { sql } from 'kysely';
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
import { AppDbService } from '../../../common/db/app-db.service';

@Injectable()
export class BiAgentPromptStoreService implements OnModuleInit {
  private readonly log = new Logger(BiAgentPromptStoreService.name);

  constructor(private readonly appDb: AppDbService) {}

  async onModuleInit(): Promise<void> {
    await this.ensureTableAndSeed();
  }

  private async ensureTableAndSeed(): Promise<void> {
    await this.appDb.executeDdl(`
      CREATE TABLE IF NOT EXISTS public.bi_agent_prompts (
        id text PRIMARY KEY,
        file_name text NOT NULL UNIQUE,
        label text NOT NULL,
        body text NOT NULL DEFAULT '',
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);

    for (const d of AGENT_PROMPT_DEFINITIONS) {
      await this.appDb.db
        .insertInto('bi_agent_prompts')
        .values({ id: d.id, file_name: d.fileName, label: d.labelFr, body: '' })
        .onConflict((oc) => oc.column('id').doNothing())
        .execute();
    }

    for (const id of AGENT_PROMPT_IDS) {
      const row = await this.appDb.db
        .selectFrom('bi_agent_prompts')
        .select('body')
        .where('id', '=', id)
        .executeTakeFirst();

      const stored = row?.body ?? '';
      if (stored.trim().length === 0) {
        const fallback = getInstallDefaultPrompt(id);
        await this.appDb.db
          .updateTable('bi_agent_prompts')
          .set({ body: fallback, updated_at: sql`now()` })
          .where('id', '=', id)
          .execute();
        this.log.log(`Prompt ${id}: corps vide en base → modèle d'installation écrit.`);
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
    if (!def) throw new Error(`Définition prompt manquante: ${id}`);

    const row = await this.appDb.db
      .selectFrom('bi_agent_prompts')
      .select('body')
      .where('id', '=', id)
      .executeTakeFirst();

    const stored = row?.body ?? '';
    if (stored.trim().length > 0) return stored;

    const fallback = getInstallDefaultPrompt(id);
    this.log.warn(
      `Prompt ${id}: corps DB vide à l'exécution — repli modèle d'installation.`,
    );
    return fallback;
  }

  async listPromptsWithSource() {
    const rows = await this.appDb.db
      .selectFrom('bi_agent_prompts')
      .select(['id', 'body'])
      .where('id', 'in', Array.from(AGENT_PROMPT_IDS))
      .execute();

    const byId = new Map<string, string>();
    for (const row of rows) byId.set(row.id, row.body ?? '');

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

    const row = await this.appDb.db
      .selectFrom('bi_agent_prompts')
      .select(['body', 'updated_at as updatedAt'])
      .where('id', '=', pid)
      .executeTakeFirst();

    const storedBody = row?.body ?? '';
    const defaultBody = getInstallDefaultPrompt(pid);
    const effectiveBody = storedBody.trim().length > 0 ? storedBody : defaultBody;

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
      updatedAt:
        row?.updatedAt instanceof Date
          ? row.updatedAt.toISOString()
          : (row?.updatedAt ? String(row.updatedAt) : null),
    };
  }

  async setPromptBody(id: string, body: string | null): Promise<void> {
    const pid = this.assertPromptId(id);
    const def = getAgentPromptDefinition(pid)!;
    const normalized =
      body == null || body.trim().length === 0
        ? getInstallDefaultPrompt(pid)
        : body;

    await this.appDb.db
      .insertInto('bi_agent_prompts')
      .values({
        id: pid,
        file_name: def.fileName,
        label: def.labelFr,
        body: normalized,
        updated_at: sql`now()`,
      })
      .onConflict((oc) =>
        oc.column('id').doUpdateSet({ body: normalized, updated_at: sql`now()` }),
      )
      .execute();
  }
}
