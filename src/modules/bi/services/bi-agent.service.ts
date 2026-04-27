import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { buildBiTools } from '../lib/bi-tools';
import {
  biAgentOutputSchema,
  type BiAgentOutput,
} from '../schemas/bi-output.schema';
import {
  buildGreetingResponse,
  isSimpleGreeting,
} from '../lib/greeting-fast-path';
import {
  extractToolCallName,
  humanizeToolCallBatch,
  humanizeToolResult,
  inferToolNameFromMessage,
} from '../lib/bi-stream-status';
import {
  isLikelyUserPromptInjection,
  USER_MESSAGE_BLOCKED,
} from '../lib/prompt-safety';
import type { DataAccess } from '../../../common/types/data-access';
import { BiDataTablesService } from '../../../common/bi-tables/bi-data-tables.service';
import { BiPromptService, type BiResponseMode } from './bi-prompt.service';
import { ChatHistoryService } from './chat-history.service';
import type { BddSchema } from './schema.service';
import { SchemaService } from './schema.service';

export type BiStreamEvent =
  | { t: 'status'; m: string }
  | ({ t: 'done'; output: string } & BiAgentOutput)
  | { t: 'error'; message: string };

@Injectable()
export class BiAgentService {
  private readonly log = new Logger(BiAgentService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly schema: SchemaService,
    private readonly biTables: BiDataTablesService,
    private readonly prompts: BiPromptService,
    private readonly chatHistory: ChatHistoryService,
  ) {}

  /**
   * Prépare l’agent (ou la réponse de salutation). Facteur commun à runChat / streamChat.
   */
  private async resolveBddForAccess(
    dataAccess: DataAccess,
  ): Promise<{ bdd: { json: BddSchema } }> {
    const full = await this.schema.getBddJson();
    if (dataAccess.kind === 'all') {
      return full;
    }
    const names = new Set(
      dataAccess.tableNames.filter((t) => this.biTables.isBiDataTableName(t)),
    );
    if (names.size === 0) {
      return { bdd: { json: {} } };
    }
    const j: BddSchema = {};
    for (const k of Object.keys(full.bdd.json)) {
      if (names.has(k)) {
        j[k] = full.bdd.json[k]!;
      }
    }
    return { bdd: { json: j } };
  }

  private normalizeResponseMode(
    raw: 'quick' | 'pro' | undefined,
  ): BiResponseMode {
    return raw === 'quick' ? 'quick' : 'pro';
  }

  private async prepareAgentOrGreeting(input: {
    message: string;
    chatId: string;
    dataAccess: DataAccess;
    responseMode?: 'quick' | 'pro';
  }): Promise<
    | {
        kind: 'greeting';
        out: { output: string } & BiAgentOutput;
      }
    | {
        kind: 'agent';
        agent: ReturnType<typeof createReactAgent>;
        baseMessages: BaseMessage[];
        userText: string;
      }
  > {
    if (isLikelyUserPromptInjection(input.message)) {
      this.log.warn('Message utilisateur rejeté (anti–contournement consigne)');
      throw new BadRequestException(USER_MESSAGE_BLOCKED);
    }

    if (isSimpleGreeting(input.message)) {
      this.log.debug('Salutation détectée → réponse rapide (sans LLM)');
      const out = buildGreetingResponse();
      return { kind: 'greeting', out };
    }

    if (
      input.dataAccess.kind === 'restricted' &&
      input.dataAccess.tableNames.filter((t) =>
        this.biTables.isBiDataTableName(t),
      ).length === 0
    ) {
      throw new BadRequestException(
        'Aucune table de données n’est associée à votre rôle. Contactez un administrateur.',
      );
    }

    const maxPast = this.chatHistory.getMaxMessages();
    const [{ bdd }, past] = await Promise.all([
      this.resolveBddForAccess(input.dataAccess),
      this.chatHistory.loadForSession(input.chatId, maxPast),
    ]);
    if (Object.keys(bdd.json).length === 0) {
      throw new BadRequestException(
        'Schéma métier vide pour les tables autorisées.',
      );
    }
    const formuleKpi = this.prompts.getFormuleKpiTemplate();
    const responseMode = this.normalizeResponseMode(input.responseMode);
    const system = this.prompts.buildSystemMessage(bdd, formuleKpi, responseMode);
    const geminiModel: string =
      this.config.get<string>('GEMINI_MODEL') ?? 'gemini-3-flash-preview';
    const model = new ChatGoogleGenerativeAI({
      model: geminiModel,
      temperature: 0.15,
      apiKey: this.config.getOrThrow<string>('GOOGLE_API_KEY'),
    });
    const tools = buildBiTools(
      this.schema,
      input.dataAccess,
      this.biTables,
    );
    const agent = createReactAgent({
      llm: model,
      tools: [...tools],
      prompt: system,
      responseFormat: biAgentOutputSchema,
    });
    const line = `(date now : ${new Date().toISOString()}) , ${input.message}`;
    const baseMessages: BaseMessage[] = past.map((p) => {
      if (p.role === 'user') {
        return new HumanMessage(p.text);
      }
      return new AIMessage(p.text);
    });
    baseMessages.push(new HumanMessage(line));
    return {
      kind: 'agent',
      agent,
      baseMessages,
      userText: input.message,
    };
  }

  /**
   * Équivalent du flux n8n : init → AI Agent (tools + responseFormat) → clean html.
   */
  async runChat(input: {
    message: string;
    chatId: string;
    dataAccess?: DataAccess;
    responseMode?: 'quick' | 'pro';
  }): Promise<{ output: string } & BiAgentOutput> {
    const ctx = await this.prepareAgentOrGreeting({
      ...input,
      dataAccess: input.dataAccess ?? { kind: 'all' },
    });
    if (ctx.kind === 'greeting') {
      const gr = ctx.out;
      await this.persistTurn(input.chatId, input.message, gr);
      return { ...gr, output: this.cleanHtml(gr.html) };
    }
    const res = (await ctx.agent.invoke(
      { messages: ctx.baseMessages },
      { recursionLimit: this.agentRecursionLimit() },
    )) as { structuredResponse?: BiAgentOutput; messages?: unknown[] };
    const sr = res.structuredResponse;
    if (!sr) {
      this.log.error('structuredResponse manquant, état: %j', {
        msgCount: (res as { messages?: unknown[] })?.messages?.length,
      });
      throw new InternalServerErrorException('Sortie structurée manquante');
    }
    const out = { output: this.cleanHtml(sr.html), ...sr };
    await this.persistTurn(input.chatId, ctx.userText, out);
    return out;
  }

  /**
   * Même exécution que runChat, avec événements de progression (tâches métier, libellés lisibles) pour l’UI en streaming.
   */
  async *streamChat(input: {
    message: string;
    chatId: string;
    dataAccess?: DataAccess;
    responseMode?: 'quick' | 'pro';
  }): AsyncGenerator<BiStreamEvent> {
    const responseMode = this.normalizeResponseMode(input.responseMode);
    const ctx = await this.prepareAgentOrGreeting({
      ...input,
      dataAccess: input.dataAccess ?? { kind: 'all' },
    });
    if (ctx.kind === 'greeting') {
      yield { t: 'status', m: 'Génération de la réponse d’accueil…' };
      const gr = ctx.out;
      await this.persistTurn(input.chatId, input.message, gr);
      yield { t: 'done', ...gr, output: this.cleanHtml(gr.html) };
      return;
    }
    yield {
      t: 'status',
      m: 'Lecture de votre question et du contexte',
    };
    const stream = await ctx.agent.stream(
      { messages: ctx.baseMessages },
      {
        streamMode: 'values' as const,
        recursionLimit: this.agentRecursionLimit(),
      },
    );
    const inputCount = ctx.baseMessages.length;
    let lastIndex = inputCount;
    let lastState: {
      messages?: BaseMessage[];
      structuredResponse?: BiAgentOutput;
    } | null = null;
    let sqlIntentCount = 0;
    for await (const state of stream) {
      lastState = state;
      const msgs = lastState.messages;
      if (Array.isArray(msgs) && msgs.length < lastIndex) {
        this.log.warn(
          'Messages raccourcis dans le stream (rare), resync index',
        );
        lastIndex = 0;
      }
      if (Array.isArray(msgs) && msgs.length > lastIndex) {
        for (let i = lastIndex; i < msgs.length; i++) {
          const m = msgs[i];
          if (ToolMessage.isInstance(m)) {
            const name = inferToolNameFromMessage(m);
            const text =
              typeof m.content === 'string'
                ? m.content
                : JSON.stringify(m.content);
            const line = humanizeToolResult(name, text);
            if (line) {
              yield { t: 'status', m: line };
            }
          } else if (
            AIMessage.isInstance(m) &&
            m.tool_calls &&
            m.tool_calls.length > 0
          ) {
            const names = m.tool_calls.map((tc) => extractToolCallName(tc));
            const { line, nextSql } = humanizeToolCallBatch(
              names,
              sqlIntentCount,
            );
            sqlIntentCount = nextSql;
            yield { t: 'status', m: line };
          }
        }
        lastIndex = msgs.length;
      }
    }
    const sr = lastState?.structuredResponse;
    if (!sr) {
      this.log.error(
        'structuredResponse manquant (stream), lastState: %j',
        lastState,
      );
      yield { t: 'error', message: 'Sortie structurée manquante' };
      return;
    }
    yield {
      t: 'status',
      m:
        responseMode === 'quick'
          ? 'Préparation de la réponse (mode rapide, sans graphique)…'
          : 'Préparation et mise en forme de la réponse (texte, graphiques)…',
    };
    const out = { output: this.cleanHtml(sr.html), ...sr } as {
      output: string;
    } & BiAgentOutput;
    await this.persistTurn(input.chatId, ctx.userText, out);
    yield { t: 'done', ...out };
  }

  /** Nombre max de tours outil + modèle (limite LangGraph). Réduire peut raccourcir les cas extrêmes. */
  private agentRecursionLimit(): number {
    const raw = this.config.get<string>('AGENT_RECURSION_LIMIT');
    if (raw == null || String(raw).trim() === '') {
      return 40;
    }
    const n = parseInt(String(raw), 10);
    if (!Number.isFinite(n) || n < 4) {
      return 40;
    }
    return Math.min(80, n);
  }

  private cleanHtml(raw: string): string {
    return raw.replace(/^```html\s*/i, '').replace(/\s*```$/g, '');
  }

  private assistantMemoryText(sr: BiAgentOutput, outputHtml: string): string {
    const r = sr.resultatSQL?.trim();
    if (r) {
      return r.length > 12_000 ? r.slice(0, 12_000) + '…' : r;
    }
    const t = this.stripTags(outputHtml).replace(/\s+/g, ' ').trim();
    if (t) {
      return t.length > 4_000 ? t.slice(0, 4_000) + '…' : t;
    }
    return '—';
  }

  private stripTags(html: string): string {
    return html.replace(/<[^>]+>/g, ' ');
  }

  private async persistTurn(
    sessionId: string,
    userText: string,
    sr: BiAgentOutput,
  ) {
    const out = this.cleanHtml(sr.html);
    await this.chatHistory.append(sessionId, { role: 'user', text: userText });
    await this.chatHistory.append(sessionId, {
      role: 'assistant',
      text: this.assistantMemoryText(sr, out),
    });
  }
}
