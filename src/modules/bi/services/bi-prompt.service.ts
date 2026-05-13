import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';

export type BiResponseMode = 'quick' | 'pro';

@Injectable()
export class BiPromptService {
  private staticPrompt: string | null = null;
  private formuleKpi: string | null = null;
  private quickModePrompt: string | null = null;
  private htmlRenderPrompt: string | null = null;

  private readPromptFile(filename: string): string {
    const candidates = [
      join(__dirname, '..', 'prompts', filename),
      join(process.cwd(), 'dist', 'modules', 'bi', 'prompts', filename),
      join(process.cwd(), 'src', 'modules', 'bi', 'prompts', filename),
    ];
    for (const p of candidates) {
      if (existsSync(p)) {
        return readFileSync(p, 'utf-8');
      }
    }
    throw new Error(
      `Fichier prompt introuvable: ${filename} (candidats: ${candidates.join(', ')})`,
    );
  }

  getStaticPrompt(): string {
    this.staticPrompt ??= this.readPromptFile('static.txt');
    return this.staticPrompt;
  }

  getFormuleKpiTemplate(): string {
    this.formuleKpi ??= this.readPromptFile('formule-kpi.txt');
    return this.formuleKpi;
  }

  private getQuickModePrompt(): string {
    this.quickModePrompt ??= this.readPromptFile('mode-quick.txt');
    return this.quickModePrompt;
  }

  getHtmlRenderPrompt(): string {
    this.htmlRenderPrompt ??= this.readPromptFile('html-render.txt');
    return this.htmlRenderPrompt;
  }

  buildSystemMessage(
    bdd: unknown,
    formuleKpi: string,
    mode: BiResponseMode = 'pro',
  ): string {
    const modeBlock =
      mode === 'quick' ? `${this.getQuickModePrompt().trimEnd()}\n\n` : '';
    return this.getStaticPrompt()
      .replaceAll('__RESPONSE_MODE_BLOCK__', modeBlock)
      .replace(
        '__SCHEMA_BLOCK__',
        `**schemaDataBasePostgreSQL:**\n${JSON.stringify(bdd)}`,
      )
      .replace('__KPI_BLOCK__', `**KPI Formulas:**\n${formuleKpi}`);
  }
}
