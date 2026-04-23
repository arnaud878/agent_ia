import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HumanMessage } from '@langchain/core/messages';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { BiPromptService } from './bi-prompt.service';
import { SchemaService } from './schema.service';
import { buildBiTools } from './bi-tools';
import { biAgentOutputSchema, type BiAgentOutput } from './bi-output.schema';

@Injectable()
export class BiAgentService {
  private readonly log = new Logger(BiAgentService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly schema: SchemaService,
    private readonly prompts: BiPromptService,
  ) {}

  /**
   * Équivalent du flux n8n : init → AI Agent (tools + responseFormat) → clean html.
   */
  async runChat(input: {
    message: string;
    chatId: string;
  }): Promise<{ output: string } & BiAgentOutput> {
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
    const res = (await agent.invoke(
      { messages: [new HumanMessage(line)] },
      { recursionLimit: 40 },
    )) as { structuredResponse?: BiAgentOutput; messages?: unknown[] };
    const sr = res.structuredResponse;
    if (!sr) {
      this.log.error('structuredResponse manquant, état: %j', {
        msgCount: (res as { messages?: unknown[] })?.messages?.length,
      });
      throw new InternalServerErrorException('Sortie structurée manquante');
    }
    return { output: this.cleanHtml(sr.html), ...sr };
  }

  private cleanHtml(raw: string): string {
    return raw.replace(/^```html\s*/i, '').replace(/\s*```$/g, '');
  }
}
