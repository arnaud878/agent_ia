import {
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
import { ChatHistoryService } from './chat-history.service';
import { BiPromptService } from './bi-prompt.service';
import { SchemaService } from './schema.service';
import { buildBiTools } from './bi-tools';
import { biAgentOutputSchema, type BiAgentOutput } from './bi-output.schema';
import { buildGreetingResponse, isSimpleGreeting } from './greeting-fast-path';

export type BiStreamEvent =
  | { t: 'status'; m: string }
  | { t: 'done'; output: string } & BiAgentOutput
  | { t: 'error'; message: string };

@Injectable()
export class BiAgentService {
  private readonly log = new Logger(BiAgentService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly schema: SchemaService,
    private readonly prompts: BiPromptService,
    private readonly chatHistory: ChatHistoryService,
  ) {}

  /**
   * Prépare l’agent (ou la réponse de salutation). Facteur commun à runChat / streamChat.
   */
  private async prepareAgentOrGreeting(input: { message: string; chatId: string }): Promise<
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
    if (isSimpleGreeting(input.message)) {
      this.log.debug('Salutation détectée → réponse rapide (sans LLM)');
      const out = buildGreetingResponse();
      return { kind: 'greeting', out };
    }

    const { bdd } = await this.schema.getBddJson();
    const formuleKpi = this.prompts.getFormuleKpiTemplate();
    const system = this.prompts.buildSystemMessage(bdd, formuleKpi);
    const geminiModel: string =
      this.config.get<string>('GEMINI_MODEL') ?? 'gemini-3-flash-preview';
    const model = new ChatGoogleGenerativeAI({
      model: geminiModel,
      temperature: 0.15,
      apiKey: this.config.getOrThrow<string>('GOOGLE_API_KEY'),
    });
    const tools = buildBiTools(this.schema);
    const agent = createReactAgent({
      llm: model,
      tools: [...tools],
      prompt: system,
      responseFormat: biAgentOutputSchema,
    });
    const line = `(date now : ${new Date().toISOString()}) , ${input.message}`;
    const maxPast = this.chatHistory.getMaxMessages();
    const past = await this.chatHistory.loadForSession(input.chatId, maxPast);
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
  }): Promise<{ output: string } & BiAgentOutput> {
    const ctx = await this.prepareAgentOrGreeting(input);
    if (ctx.kind === 'greeting') {
      const gr = ctx.out;
      await this.persistTurn(input.chatId, input.message, gr);
      return { ...gr, output: this.cleanHtml(gr.html) };
    }
    const res = (await ctx.agent.invoke(
      { messages: ctx.baseMessages },
      { recursionLimit: 40 },
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
  }): AsyncGenerator<BiStreamEvent> {
    const ctx = await this.prepareAgentOrGreeting(input);
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
      { streamMode: 'values' as const, recursionLimit: 40 },
    );
    const inputCount = ctx.baseMessages.length;
    let lastIndex = inputCount;
    let lastState: {
      messages?: BaseMessage[];
      structuredResponse?: BiAgentOutput;
    } | null = null;
    /** Compte chaque « intention » vers la base (libellé distinct, même texte). */
    let sqlIntentCount = 0;
    for await (const state of stream) {
      lastState = state as { messages?: BaseMessage[]; structuredResponse?: BiAgentOutput };
      const msgs = lastState.messages;
      if (Array.isArray(msgs) && msgs.length < lastIndex) {
        this.log.warn('Messages raccourcis dans le stream (rare), resync index');
        lastIndex = 0;
      }
      if (Array.isArray(msgs) && msgs.length > lastIndex) {
        for (let i = lastIndex; i < msgs.length; i++) {
          const m = msgs[i]!;
          if (ToolMessage.isInstance(m)) {
            const name = this.inferToolNameFromMessage(m);
            const text =
              typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
            const line = this.humanizeToolResult(name, text);
            if (line) {
              yield { t: 'status', m: line };
            }
          } else if (AIMessage.isInstance(m) && m.tool_calls && m.tool_calls.length > 0) {
            const names = m.tool_calls.map((tc) => this.extractToolCallName(tc));
            const { line, nextSql } = this.humanizeToolCallBatch(names, sqlIntentCount);
            sqlIntentCount = nextSql;
            yield { t: 'status', m: line };
          }
        }
        lastIndex = msgs.length;
      }
    }
    const sr = lastState?.structuredResponse;
    if (!sr) {
      this.log.error('structuredResponse manquant (stream), lastState: %j', lastState);
      yield { t: 'error', message: 'Sortie structurée manquante' };
      return;
    }
    yield { t: 'status', m: 'Préparation et mise en forme de la réponse (texte, graphiques)…' };
    const out = { output: this.cleanHtml(sr.html), ...sr } as { output: string } & BiAgentOutput;
    await this.persistTurn(input.chatId, ctx.userText, out);
    yield { t: 'done', ...out };
  }

  /**
   * Un appel d’outils côté modèle (noms possibles : SQLExecutor, Think, `function.name`, etc.).
   */
  private extractToolCallName(tc: unknown): string {
    if (tc && typeof tc === 'object') {
      const o = tc as Record<string, unknown>;
      if (typeof o.name === 'string' && o.name.trim().length) {
        return o.name;
      }
      const fn = o.function;
      if (fn && typeof fn === 'object' && (fn as { name?: string }).name) {
        return String((fn as { name: string }).name);
      }
    }
    return 'unknown';
  }

  /**
   * Regroupement des noms techniques vers un petit nombre de catégories métier.
   */
  private classifyToolName(name: string): 'sql' | 'think' | 'calc' | 'unknown' {
    const s = (name || '').toLowerCase().replace(/[\s_-]/g, '');
    if (s.includes('sql') || s.includes('sqlexecutor')) {
      return 'sql';
    }
    if (s.includes('think')) {
      return 'think';
    }
    if (s.includes('calculator') || s === 'calc' || s.includes('calculat')) {
      return 'calc';
    }
    return 'unknown';
  }

  private inferToolNameFromMessage(m: ToolMessage): string {
    const n = m.name;
    if (n && n.trim().length) {
      return n;
    }
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    if (this.looksLikeSqlResultPayload(text)) {
      return 'SQLExecutor';
    }
    return 'unknown';
  }

  private looksLikeSqlResultPayload(text: string): boolean {
    const t = text.trim();
    if (t.startsWith('{') && t.includes('"rowCount"')) {
      return true;
    }
    if (t.includes('rowCount') && (t.includes('rows') || t.includes('warning'))) {
      return true;
    }
    return false;
  }

  /**
   * Libellés 100 % utilisateur (aucun nom d’outil).
   * `nextSql` compte les libellés « récupération » pour varier l’intitulé à chaque tour.
   */
  private humanizeToolCallBatch(
    rawNames: string[],
    sqlIntentCount: number,
  ): { line: string; nextSql: number } {
    const kinds = new Set(rawNames.map((r) => this.classifyToolName(r)));
    const hasSql = kinds.has('sql');
    const hasThink = kinds.has('think');
    const hasCalc = kinds.has('calc');
    let nextSql = sqlIntentCount;
    if (hasSql) {
      nextSql += 1;
    }
    if (hasSql && hasThink && hasCalc) {
      return {
        line:
          'Récupération des données, approfondissement de l’analyse et calculs d’indicateurs…',
        nextSql,
      };
    }
    if (hasSql && hasThink) {
      return {
        line: 'Lecture de la base et affinage de l’analyse de votre question…',
        nextSql,
      };
    }
    if (hasSql && hasCalc) {
      return {
        line: 'Lecture de la base et calcul des indicateurs chiffrés…',
        nextSql,
      };
    }
    if (hasThink && hasCalc) {
      return { line: 'Analyse de la requête et calcul des indicateurs…', nextSql };
    }
    if (hasSql) {
      if (nextSql <= 1) {
        return {
          line: 'Récupération des données …',
          nextSql,
        };
      }
      return {
        line: `Nouvelle récupération de données (étape ${nextSql})…`,
        nextSql,
      };
    }
    if (hasThink) {
      return { line: 'Analyse de la question et structuration de la démarche…', nextSql };
    }
    if (hasCalc) {
      return { line: 'Calculs sur les chiffres et les indicateurs…', nextSql };
    }
    return { line: 'Traitement de votre demande en cours…', nextSql };
  }

  /**
   * Libellé après exécution d’une brique (résultat pris en compte dans la suite).
   */
  private humanizeToolResult(toolName: string, content: string): string | null {
    const k = this.classifyToolName(toolName);
    const effective: 'sql' | 'think' | 'calc' | 'unknown' =
      k === 'unknown' && this.looksLikeSqlResultPayload(content) ? 'sql' : k;
    if (effective === 'sql') {
      try {
        const j = JSON.parse(content) as { rowCount?: number };
        const n =
          typeof j?.rowCount === 'number' && Number.isFinite(j.rowCount)
            ? j.rowCount
            : null;
        if (n === null) {
          return 'Données reçues et analysées (résultat intégré).';
        }
        if (n === 0) {
          return 'Aucun enregistrement ne correspond (0 ligne) — poursuite de l’analyse.';
        }
        if (n === 1) {
          return '1 enregistrement reçu, pris en compte pour la suite du raisonnement.';
        }
        return `${n} enregistrements reçus et pris en compte pour la suite.`;
      } catch {
        return 'Nouveaux chiffres reçus et intégrés à l’analyse.';
      }
    }
    if (effective === 'think') {
      return 'Analyse intermédiaire enregistrée (orientation de la réponse)…';
    }
    if (effective === 'calc') {
      return 'Calculs mis à jour pour la suite du raisonnement…';
    }
    return 'Étape prise en compte pour la suite…';
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
