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
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { buildBiTools } from '../lib/bi-tools';
import {
  biAgentOutputSchema,
  type BiAgentOutput,
} from '../schemas/bi-output.schema';
import { buildTrivialShortReply } from '../lib/trivial-short-reply';
import { extractFirstJsonObject } from '../lib/extract-json-object';
import {
  inferReplyLocaleFromText,
  INTENT_CLASSIFIER_JSON_SUFFIX,
  replyLocaleSchema,
  SOCIAL_TRIVIAL_CLASSIFIER_SYSTEM,
  socialTrivialIntentSchema,
  trivialShortToneSchema,
  type ReplyLocale,
  type SocialTrivialIntent,
  type TrivialShortTone,
} from '../lib/message-intent-classifier';
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

type LlmProvider = 'gemini' | 'gpt' | 'claude';

type RuntimeLlmSettings = {
  provider: LlmProvider;
  model: string;
  apiKey: string;
};

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

  private async resolveRuntimeLlmSettings(): Promise<RuntimeLlmSettings> {
    const defaultProvider: LlmProvider = 'gemini';
    const defaultModelByProvider: Record<LlmProvider, string> = {
      gemini: this.config.get<string>('GEMINI_MODEL') ?? 'gemini-2.5-flash',
      gpt: this.config.get<string>('OPENAI_MODEL') ?? 'gpt-4.1-mini',
      claude:
        this.config.get<string>('ANTHROPIC_MODEL') ?? 'claude-3-5-sonnet-latest',
    };
    const defaultKeyByProvider: Record<LlmProvider, string | undefined> = {
      gemini: this.config.get<string>('GOOGLE_API_KEY'),
      gpt: this.config.get<string>('OPENAI_API_KEY'),
      claude: this.config.get<string>('ANTHROPIC_API_KEY'),
    };

    let row:
      | { provider?: string; model?: string; apiKey?: string | null }
      | undefined;
    try {
      const r = await this.schema.executeAppQuery(
        `SELECT provider, model, api_key AS "apiKey"
         FROM public.bi_llm_settings
         WHERE id = true`,
      );
      row = r.rows[0] as
        | { provider?: string; model?: string; apiKey?: string | null }
        | undefined;
    } catch {
      row = undefined;
    }
    const provider =
      row?.provider === 'gpt' || row?.provider === 'claude' || row?.provider === 'gemini'
        ? row.provider
        : defaultProvider;
    const model = String(row?.model ?? defaultModelByProvider[provider]).trim();
    const apiKey = String(row?.apiKey ?? defaultKeyByProvider[provider] ?? '').trim();

    if (!apiKey) {
      throw new BadRequestException(
        `Clé API LLM manquante pour le provider ${provider}. Configurez-la dans Admin > Base BI.`,
      );
    }
    return { provider, model, apiKey };
  }

  private buildRuntimeModel(settings: RuntimeLlmSettings) {
    if (settings.provider === 'gpt') {
      return new ChatOpenAI({
        model: settings.model,
        temperature: 0.15,
        apiKey: settings.apiKey,
      });
    }
    if (settings.provider === 'claude') {
      return new ChatAnthropic({
        model: settings.model,
        temperature: 0.15,
        apiKey: settings.apiKey,
      });
    }
    return new ChatGoogleGenerativeAI({
      model: settings.model,
      temperature: 0.15,
      apiKey: settings.apiKey,
    });
  }

  /** Modèle court, température 0, pour la classification d’intention (pas l’agent outils). */
  private buildIntentClassifierModel(settings: RuntimeLlmSettings) {
    /** Marge large : sortie structurée / JSON Gemini peut être tronquée si trop bas. */
    const cap = 1024;
    if (settings.provider === 'gpt') {
      return new ChatOpenAI({
        model: settings.model,
        temperature: 0,
        maxTokens: cap,
        apiKey: settings.apiKey,
      });
    }
    if (settings.provider === 'claude') {
      return new ChatAnthropic({
        model: settings.model,
        temperature: 0,
        maxTokens: cap,
        apiKey: settings.apiKey,
      });
    }
    return new ChatGoogleGenerativeAI({
      model: settings.model,
      temperature: 0,
      apiKey: settings.apiKey,
      maxOutputTokens: cap,
    });
  }

  /** Repli si withStructuredOutput échoue (JSON coupé, parseur LangChain, etc.). */
  private async invokeIntentClassifierPlainJson(
    mini: ChatOpenAI | ChatAnthropic | ChatGoogleGenerativeAI,
    userText: string,
  ): Promise<SocialTrivialIntent | null> {
    try {
      const res = await mini.invoke([
        new SystemMessage(
          SOCIAL_TRIVIAL_CLASSIFIER_SYSTEM + INTENT_CLASSIFIER_JSON_SUFFIX,
        ),
        new HumanMessage(userText),
      ]);
      const content =
        typeof res.content === 'string'
          ? res.content
          : JSON.stringify(res.content);
      const obj = extractFirstJsonObject(content);
      const parsed = socialTrivialIntentSchema.safeParse(obj);
      return parsed.success ? parsed.data : null;
    } catch (e) {
      this.log.warn(`invokeIntentClassifierPlainJson: ${e}`);
      return null;
    }
  }

  private mapClassifierToIntent(
    out: SocialTrivialIntent,
    userMessage: string,
    fallbackLoc: ReplyLocale,
  ): {
    trivial: boolean;
    shortTone: TrivialShortTone;
    replyLocale: ReplyLocale;
  } {
    const m = userMessage.trim();
    const trivial = out.trivial === true;
    let shortTone: TrivialShortTone = 'generic';
    if (trivial) {
      const parsed = trivialShortToneSchema.safeParse(out.shortTone);
      shortTone = parsed.success ? parsed.data : 'generic';
    }
    let replyLocale: ReplyLocale = inferReplyLocaleFromText(m);
    const locParsed = replyLocaleSchema.safeParse(out.replyLocale);
    if (locParsed.success) {
      replyLocale = locParsed.data;
    }
    return { trivial, shortTone, replyLocale };
  }

  /**
   * Agent classifieur (LLM + schéma) : trivial + ton de la réponse courte (merci ≠ bonjour).
   */
  async classifyUserMessageIntent(message: string): Promise<{
    trivial: boolean;
    shortTone: TrivialShortTone;
    replyLocale: ReplyLocale;
  }> {
    const m = message.trim();
    const fallbackLoc = inferReplyLocaleFromText(message);
    if (!m) {
      return { trivial: true, shortTone: 'generic', replyLocale: fallbackLoc };
    }
    if (m.length > 6_000) {
      return { trivial: false, shortTone: 'generic', replyLocale: fallbackLoc };
    }
    try {
      const llmSettings = await this.resolveRuntimeLlmSettings();
      const mini = this.buildIntentClassifierModel(llmSettings);
      let raw: SocialTrivialIntent | null = null;
      try {
        const structured = mini.withStructuredOutput(
          socialTrivialIntentSchema,
          { name: 'intent_classifier' },
        );
        raw = await structured.invoke([
          new SystemMessage(SOCIAL_TRIVIAL_CLASSIFIER_SYSTEM),
          new HumanMessage(m),
        ]);
      } catch (e) {
        this.log.warn(
          `Classifieur structuredOutput en échec, repli JSON brut: ${e}`,
        );
        raw = await this.invokeIntentClassifierPlainJson(mini, m);
      }
      if (!raw) {
        this.log.warn(
          'classifyUserMessageIntent: sortie classifieur vide, branche agent complète',
        );
        return { trivial: false, shortTone: 'generic', replyLocale: fallbackLoc };
      }
      const { trivial, shortTone, replyLocale } = this.mapClassifierToIntent(
        raw,
        m,
        fallbackLoc,
      );
      this.log.debug(
        `Classifieur d’intention: trivial=${trivial} shortTone=${shortTone} replyLocale=${replyLocale}`,
      );
      return { trivial, shortTone, replyLocale };
    } catch (e) {
      this.log.warn(
        `classifyUserMessageIntent échoué, branche agent complète: ${e}`,
      );
      return { trivial: false, shortTone: 'generic', replyLocale: fallbackLoc };
    }
  }

  private async prepareAgentOrGreeting(input: {
    message: string;
    chatId: string;
    dataAccess: DataAccess;
    responseMode?: 'quick' | 'pro';
    trivialSocial: boolean;
    trivialShortTone?: TrivialShortTone;
    trivialReplyLocale?: ReplyLocale;
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

    if (input.trivialSocial) {
      const tone = input.trivialShortTone ?? 'generic';
      const locale = input.trivialReplyLocale ?? 'fr';
      this.log.debug(
        `Classifieur: trivial → réponse courte (ton=${tone}, locale=${locale}) sans agent outils`,
      );
      const out = buildTrivialShortReply(tone, locale);
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
    const llmSettings = await this.resolveRuntimeLlmSettings();
    const model = this.buildRuntimeModel(llmSettings);
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
    const userLoc = inferReplyLocaleFromText(input.message);
    const langHint =
      userLoc === 'en'
        ? ' [Instruction: user writes in English — produce user-facing text in English.]'
        : '';
    const line = `(date now : ${new Date().toISOString()}) , ${input.message}${langHint}`;
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
    trivialSocial: boolean;
    trivialShortTone?: TrivialShortTone;
    trivialReplyLocale?: ReplyLocale;
  }): Promise<{ output: string } & BiAgentOutput> {
    const ctx = await this.prepareAgentOrGreeting({
      ...input,
      dataAccess: input.dataAccess ?? { kind: 'all' },
      trivialSocial: input.trivialSocial,
      trivialShortTone: input.trivialShortTone,
      trivialReplyLocale: input.trivialReplyLocale,
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
    const rawSqlResult = this.extractLastRawSqlResult(res.messages);
    const out = {
      output: this.cleanHtml(sr.html),
      ...sr,
      resultatSQL: rawSqlResult ?? sr.resultatSQL,
    };
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
    trivialSocial: boolean;
    trivialShortTone?: TrivialShortTone;
    trivialReplyLocale?: ReplyLocale;
  }): AsyncGenerator<BiStreamEvent> {
    const responseMode = this.normalizeResponseMode(input.responseMode);
    const ctx = await this.prepareAgentOrGreeting({
      ...input,
      dataAccess: input.dataAccess ?? { kind: 'all' },
      trivialSocial: input.trivialSocial,
      trivialShortTone: input.trivialShortTone,
      trivialReplyLocale: input.trivialReplyLocale,
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
    const rawSqlResult = this.extractLastRawSqlResult(lastState?.messages);
    const out = {
      output: this.cleanHtml(sr.html),
      ...sr,
      resultatSQL: rawSqlResult ?? sr.resultatSQL,
    } as {
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

  private toolMessageContentAsText(m: ToolMessage): string {
    return typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
  }

  private extractLastRawSqlResult(
    messages: BaseMessage[] | unknown[] | undefined,
  ): string | null {
    if (!Array.isArray(messages) || messages.length === 0) {
      return null;
    }
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!ToolMessage.isInstance(msg)) {
        continue;
      }
      const name = inferToolNameFromMessage(msg).toLowerCase();
      if (name.includes('sql')) {
        return this.toolMessageContentAsText(msg);
      }
    }
    return null;
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
