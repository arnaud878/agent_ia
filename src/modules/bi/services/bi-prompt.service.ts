import { Injectable } from '@nestjs/common';
import { BiAgentPromptStoreService } from './bi-agent-prompt-store.service';

export type BiResponseMode = 'quick' | 'pro';

@Injectable()
export class BiPromptService {
  constructor(private readonly promptStore: BiAgentPromptStoreService) {}

  getStaticPrompt(): Promise<string> {
    return this.promptStore.resolvePromptBody('static');
  }

  getFormuleKpiTemplate(): Promise<string> {
    return this.promptStore.resolvePromptBody('formule-kpi');
  }

  private getQuickModePrompt(): Promise<string> {
    return this.promptStore.resolvePromptBody('mode-quick');
  }

  getHtmlRenderPrompt(): Promise<string> {
    return this.promptStore.resolvePromptBody('html-render');
  }

  async buildSystemMessage(
    bdd: unknown,
    formuleKpi: string,
    mode: BiResponseMode = 'pro',
  ): Promise<string> {
    const staticText = await this.getStaticPrompt();
    const modeBlock =
      mode === 'quick'
        ? `${(await this.getQuickModePrompt()).trimEnd()}\n\n`
        : '';
    return staticText
      .replaceAll('__RESPONSE_MODE_BLOCK__', modeBlock)
      .replace(
        '__SCHEMA_BLOCK__',
        `**schemaDataBasePostgreSQL:**\n${JSON.stringify(bdd)}`,
      )
      .replace('__KPI_BLOCK__', `**KPI Formulas:**\n${formuleKpi}`);
  }
}
