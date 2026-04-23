import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';

@Injectable()
export class BiPromptService {
  private staticPrompt: string | null = null;
  private formuleKpi: string | null = null;

  private readPromptFile(filename: string): string {
    const candidates = [
      join(__dirname, 'prompts', filename),
      join(process.cwd(), 'dist', 'bi', 'prompts', filename),
      join(process.cwd(), 'src', 'bi', 'prompts', filename),
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

  buildSystemMessage(bdd: unknown, formuleKpi: string): string {
    return this.getStaticPrompt()
      .replace(
        '__SCHEMA_BLOCK__',
        `**schemaDataBasePostgreSQL:**\n${JSON.stringify(bdd)}`,
      )
      .replace('__KPI_BLOCK__', `**KPI Formulas:**\n${formuleKpi}`);
  }
}
