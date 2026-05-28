import { Injectable } from '@nestjs/common';
import { BiAgentPromptStoreService } from './bi-agent-prompt-store.service';

export type BiResponseMode = 'quick' | 'pro';

const PRO_MODE_JSON_DISCIPLINE = `### Mode Pro — sortie JSON stricte (obligatoire)
- JSON **valide et complet** : toutes les chaînes fermées ; si limite de tokens → **raccourcir** les textes, jamais remplir avec des unités répétées.
- **Interdit** : boucles « (Mrd Ar) », « Mrd Ar » ou remplissage sans contenu.
- \`resultatSQL\` = **résumé** des faits (pas copier tout le JSON outil SQL).
- \`diagnosticDeepDive\` : **8–12 phrases** maximum, chacune avec au moins un chiffre ou un fait SQL.

`;

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
        : PRO_MODE_JSON_DISCIPLINE;
    return staticText
      .replaceAll('__RESPONSE_MODE_BLOCK__', modeBlock)
      .replace(
        '__SCHEMA_BLOCK__',
        `**schemaDataBasePostgreSQL:**\n${JSON.stringify(bdd)}`,
      )
      .replace('__KPI_BLOCK__', `**KPI Formulas:**\n${formuleKpi}`);
  }
}
