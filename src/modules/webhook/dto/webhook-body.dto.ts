import { IsArray, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class WebhookBodyDto {
  @IsString()
  message: string;

  @IsString()
  @IsOptional()
  dataContext?: string;

  @IsArray()
  @IsOptional()
  history?: unknown[];

  @IsString()
  chatId: string;

  @IsString()
  userId: string;

  /** `quick` : réponse courte sans graphique ; `pro` : comportement complet (graphiques Chart.js). */
  @IsOptional()
  @IsIn(['quick', 'pro'])
  responseMode?: 'quick' | 'pro';

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  attachmentIds?: string[];
}
