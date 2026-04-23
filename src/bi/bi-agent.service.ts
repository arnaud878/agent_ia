import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { ChatHistoryService } from './chat-history.service';
import { BiPromptService } from './bi-prompt.service';
import { SchemaService } from './schema.service';
import { buildBiTools } from './bi-tools';
import { biAgentOutputSchema, type BiAgentOutput } from './bi-output.schema';
import { buildGreetingResponse, isSimpleGreeting } from './greeting-fast-path';

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
   * Équivalent du flux n8n : init → AI Agent (tools + responseFormat) → clean html.
   */
  async runChat(input: {
    message: string;
    chatId: string;
  }): Promise<{ output: string } & BiAgentOutput> {
    if (isSimpleGreeting(input.message)) {
      this.log.debug('Salutation détectée → réponse rapide (sans LLM)');
      const gr = buildGreetingResponse();
      await this.persistTurn(input.chatId, input.message, gr);
      return gr;
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
    const res = (await agent.invoke(
      { messages: baseMessages },
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
    await this.persistTurn(input.chatId, input.message, out);
    return out;
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
