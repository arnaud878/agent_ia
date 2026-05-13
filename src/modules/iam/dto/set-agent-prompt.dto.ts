import { IsOptional, IsString } from 'class-validator';

export class SetAgentPromptDto {
  /** Vide ou absent = réinitialiser au modèle d’installation (écrit en base). */
  @IsOptional()
  @IsString()
  body?: string;
}
