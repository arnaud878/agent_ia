import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppDbService } from '../../../common/db/app-db.service';
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
  mergeAnalysisAndHtmlToBiOutput,
  type BiAgentOutput,
  type BiAnalysisOutput,
  type BiHtmlRenderOutput,
  biAnalysisOutputSchema,
  biHtmlRenderOutputSchema,
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

/** Repli phase 2 si withStructuredOutput échoue. */
const HTML_RENDER_JSON_SUFFIX = `

Réponse obligatoire : un seul objet JSON valide UTF-8, sans markdown ni texte autour.
Clé unique : "html" (chaîne : fragment HTML, guillemets et retours lignes échappés en JSON).`;

@Injectable()
export class BiAgentService {
  private readonly log = new Logger(BiAgentService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly appDb: AppDbService,
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
      row = await this.appDb.db
        .selectFrom('bi_llm_settings')
        .select(['provider', 'model', 'api_key as apiKey'])
        .where('id', '=', true)
        .executeTakeFirst() as
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

  /** Limite tokens phase 1 (agent outils + schéma analyse sans gros HTML). */
  private agentMaxAnalysisOutputTokens(): number {
    const raw = this.config.get<string>('AGENT_MAX_OUTPUT_TOKENS');
    if (raw == null || String(raw).trim() === '') {
      return 8192;
    }
    const n = parseInt(String(raw), 10);
    if (!Number.isFinite(n) || n < 2048) {
      return 8192;
    }
    return Math.min(65536, n);
  }

  /** Limite tokens phase 2 — uniquement le champ html (souvent volumineux). */
  private agentMaxHtmlRenderOutputTokens(): number {
    const raw = this.config.get<string>('AGENT_HTML_RENDER_MAX_OUTPUT_TOKENS');
    if (raw == null || String(raw).trim() === '') {
      return 16384;
    }
    const n = parseInt(String(raw), 10);
    if (!Number.isFinite(n) || n < 4096) {
      return 16384;
    }
    return Math.min(65536, n);
  }

  private buildAnalysisModel(settings: RuntimeLlmSettings) {
    const cap = this.agentMaxAnalysisOutputTokens();
    if (settings.provider === 'gpt') {
      return new ChatOpenAI({
        model: settings.model,
        temperature: 0.15,
        maxTokens: cap,
        apiKey: settings.apiKey,
      });
    }
    if (settings.provider === 'claude') {
      return new ChatAnthropic({
        model: settings.model,
        temperature: 0.15,
        maxTokens: cap,
        apiKey: settings.apiKey,
      });
    }
    return new ChatGoogleGenerativeAI({
      model: settings.model,
      temperature: 0.15,
      apiKey: settings.apiKey,
      maxOutputTokens: cap,
    });
  }

  private buildHtmlRenderModel(settings: RuntimeLlmSettings) {
    const cap = this.agentMaxHtmlRenderOutputTokens();
    if (settings.provider === 'gpt') {
      return new ChatOpenAI({
        model: settings.model,
        temperature: 0.12,
        maxTokens: cap,
        apiKey: settings.apiKey,
      });
    }
    if (settings.provider === 'claude') {
      return new ChatAnthropic({
        model: settings.model,
        temperature: 0.12,
        maxTokens: cap,
        apiKey: settings.apiKey,
      });
    }
    return new ChatGoogleGenerativeAI({
      model: settings.model,
      temperature: 0.12,
      apiKey: settings.apiKey,
      maxOutputTokens: cap,
    });
  }

  /**
   * Phase 2 : HTML seul à partir de l’analyse (sans outils).
   */
  private async runHtmlRenderPhase(
    analysis: BiAnalysisOutput,
    settings: RuntimeLlmSettings,
    responseMode: BiResponseMode,
    replyLocale: ReplyLocale,
  ): Promise<BiHtmlRenderOutput> {
    const model = this.buildHtmlRenderModel(settings);
    const system = await this.prompts.getHtmlRenderPrompt();
    const payload = {
      responseMode,
      replyLocale,
      analysis: {
        resultatSQL: analysis.resultatSQL,
        formuleKPI: analysis.formuleKPI,
        dataKPI: analysis.dataKPI,
        requeteSQL: analysis.requeteSQL,
        reportSections: analysis.reportSections,
      },
    };
    const human = `Données pour le rendu (ne pas modifier les chiffres ; respecter replyLocale pour tout texte utilisateur).\n\n${JSON.stringify(payload, null, 2)}`;
    try {
      const structured = model.withStructuredOutput(biHtmlRenderOutputSchema, {
        name: 'html_render',
      });
      return await structured.invoke([
        new SystemMessage(system),
        new HumanMessage(human),
      ]);
    } catch (e) {
      this.log.warn(`Phase 2 structuredOutput échec, repli JSON brut: ${e}`);
      return this.invokeHtmlRendererPlainJson(model, system, human, analysis);
    }
  }

  private async invokeHtmlRendererPlainJson(
    model: ChatOpenAI | ChatAnthropic | ChatGoogleGenerativeAI,
    system: string,
    human: string,
    analysis: BiAnalysisOutput,
  ): Promise<BiHtmlRenderOutput> {
    try {
      const res = await model.invoke([
        new SystemMessage(system + HTML_RENDER_JSON_SUFFIX),
        new HumanMessage(human),
      ]);
      const content =
        typeof res.content === 'string'
          ? res.content
          : JSON.stringify(res.content);
      const obj = extractFirstJsonObject(content);
      const parsed = biHtmlRenderOutputSchema.safeParse(obj);
      if (parsed.success) {
        return parsed.data;
      }
    } catch (e) {
      this.log.warn(`invokeHtmlRendererPlainJson: ${e}`);
    }
    return { html: this.fallbackHtmlFromAnalysis(analysis) };
  }

  private fallbackHtmlFromAnalysis(a: BiAnalysisOutput): string {
    const esc = (s: string) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    const rs = a.reportSections;
    const parts: string[] = [
      `<div style="font-family:system-ui,sans-serif;max-width:42rem;padding:1rem;border-radius:8px;border:1px solid #444;color:#e5e7eb;background:#111827;line-height:1.5">`,
      `<p style="margin:0 0 0.5rem 0;font-size:0.75rem;opacity:0.85">Rendu HTML simplifié (repli)</p>`,
      `<h2 style="margin:0 0 0.5rem 0;font-size:1.1rem">${esc(rs.title)}</h2>`,
      `<p style="margin:0 0 1rem 0;white-space:pre-wrap">${esc(rs.keyInsights)}</p>`,
    ];
    if (rs.executedAtLabel) {
      parts.push(
        `<p style="margin:0 0 0.75rem 0;font-size:0.85rem;opacity:0.9">${esc(rs.executedAtLabel)}</p>`,
      );
    }
    if (rs.tableHeaders?.length && rs.tableRows?.length) {
      const th = rs.tableHeaders.map((h) => `<th style="text-align:left;padding:4px 8px;border-bottom:1px solid #555">${esc(String(h))}</th>`).join('');
      const trs = rs.tableRows
        .map((row) => {
          const tds = row
            .map((cell) => `<td style="padding:4px 8px;border-bottom:1px solid #333">${esc(String(cell))}</td>`)
            .join('');
          return `<tr>${tds}</tr>`;
        })
        .join('');
      parts.push(`<table style="width:100%;border-collapse:collapse;margin-bottom:1rem"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`);
    }
    if (rs.chart && rs.chart.labels.length > 0) {
      parts.push(
        `<pre style="white-space:pre-wrap;font-size:0.8rem;opacity:0.9;margin-bottom:1rem">${esc(JSON.stringify({ chart: rs.chart }, null, 2))}</pre>`,
      );
    }
    const operational = rs.operationalActions ?? [];
    if (operational.length > 0) {
      const lis = operational.map((r) => `<li>${esc(r)}</li>`).join('');
      parts.push(
        `<h3 style="margin:0.75rem 0 0.35rem 0;font-size:0.95rem;color:#4e79a7">Actions opérationnelles</h3><ul style="margin:0;padding-left:1.25rem">${lis}</ul>`,
      );
    }
    const commercial = rs.commercialActions ?? [];
    if (commercial.length > 0) {
      const lis = commercial.map((r) => `<li>${esc(r)}</li>`).join('');
      parts.push(
        `<h3 style="margin:0.75rem 0 0.35rem 0;font-size:0.95rem;color:#f28e2b">Actions commerciales</h3><ul style="margin:0;padding-left:1.25rem">${lis}</ul>`,
      );
    }
    if (rs.strategicSummary?.trim()) {
      parts.push(
        `<h3 style="margin:0.75rem 0 0.35rem 0;font-size:0.95rem;color:#e15759">Résumé stratégique</h3><p style="margin:0;white-space:pre-wrap;font-size:0.9rem">${esc(rs.strategicSummary.trim())}</p>`,
      );
    }
    const recs = rs.recommendations ?? [];
    if (recs.length > 0) {
      const lis = recs.map((r) => `<li>${esc(r)}</li>`).join('');
      parts.push(
        `<h3 style="margin:0.75rem 0 0.35rem 0;font-size:0.95rem;color:#5cb85c">Recommandations</h3><ul style="margin:0;padding-left:1.25rem">${lis}</ul>`,
      );
    }
    if (rs.formulasNote) {
      parts.push(
        `<p style="margin-top:1rem;font-size:0.88rem;white-space:pre-wrap;opacity:0.92">${esc(rs.formulasNote)}</p>`,
      );
    }
    parts.push(`</div>`);
    return parts.join('');
  }

  /**
   * Si LangGraph ne remplit pas structuredResponse (phase 1 — analyse).
   */
  private tryRecoverAnalysisFromMessages(
    messages: BaseMessage[] | unknown[] | undefined,
  ): BiAnalysisOutput | null {
    if (!Array.isArray(messages) || messages.length === 0) {
      return null;
    }
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!AIMessage.isInstance(msg)) {
        continue;
      }
      const text = this.messageContentAsText(msg.content);
      if (!text || text.length < 12) {
        continue;
      }
      try {
        const obj = extractFirstJsonObject(text);
        const parsed = biAnalysisOutputSchema.safeParse(obj);
        if (parsed.success) {
          this.log.warn(
            'Sortie structurée phase 1 récupérée depuis le contenu brut du modèle',
          );
          return parsed.data;
        }
      } catch {
        /* message précédent */
      }
    }
    return null;
  }

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

  /** Classifieur : invocation JSON + Zod uniquement (évite OUTPUT_PARSING_FAILURE de withStructuredOutput). */
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
      const raw = await this.invokeIntentClassifierPlainJson(mini, m);
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
        responseMode: BiResponseMode;
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
    const formuleKpi = await this.prompts.getFormuleKpiTemplate();
    const responseMode = this.normalizeResponseMode(input.responseMode);
    const system = await this.prompts.buildSystemMessage(
      bdd,
      formuleKpi,
      responseMode,
    );
    const llmSettings = await this.resolveRuntimeLlmSettings();
    const model = this.buildAnalysisModel(llmSettings);
    const tools = buildBiTools(
      this.schema,
      input.dataAccess,
      this.biTables,
    );
    const agent = createReactAgent({
      llm: model,
      tools: [...tools],
      prompt: system,
      responseFormat: biAnalysisOutputSchema,
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
      responseMode,
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
    )) as { structuredResponse?: BiAnalysisOutput; messages?: unknown[] };
    let ar = res.structuredResponse;
    if (!ar) {
      ar =
        this.tryRecoverAnalysisFromMessages(
          res.messages as BaseMessage[] | undefined,
        ) ?? undefined;
    }
    if (!ar) {
      this.log.error('structuredResponse phase 1 manquant, état: %j', {
        msgCount: (res as { messages?: unknown[] })?.messages?.length,
      });
      throw new InternalServerErrorException('Sortie structurée manquante');
    }
    const llmSettings = await this.resolveRuntimeLlmSettings();
    const htmlPart = await this.runHtmlRenderPhase(
      ar,
      llmSettings,
      ctx.responseMode,
      inferReplyLocaleFromText(input.message),
    );
    const sr = mergeAnalysisAndHtmlToBiOutput(ar, htmlPart);
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
      structuredResponse?: BiAnalysisOutput;
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
    let ar = lastState?.structuredResponse;
    if (!ar) {
      ar =
        this.tryRecoverAnalysisFromMessages(lastState?.messages) ?? undefined;
    }
    if (!ar) {
      this.log.error(
        'structuredResponse phase 1 manquant (stream), lastState: %j',
        lastState,
      );
      yield { t: 'error', message: 'Sortie structurée manquante' };
      return;
    }
    yield {
      t: 'status',
      m:
        responseMode === 'quick'
          ? 'Mise en forme HTML (mode rapide)…'
          : 'Mise en forme HTML (graphiques, tableau)…',
    };
    const llmSettings = await this.resolveRuntimeLlmSettings();
    const htmlPart = await this.runHtmlRenderPhase(
      ar,
      llmSettings,
      ctx.responseMode,
      inferReplyLocaleFromText(input.message),
    );
    const sr = mergeAnalysisAndHtmlToBiOutput(ar, htmlPart);
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

  private messageContentAsText(content: unknown): string {
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const block of content) {
        if (typeof block === 'string') {
          parts.push(block);
          continue;
        }
        if (block && typeof block === 'object' && 'text' in block) {
          const t = (block as { text?: unknown }).text;
          if (typeof t === 'string') {
            parts.push(t);
          }
        }
      }
      return parts.join('');
    }
    return '';
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
