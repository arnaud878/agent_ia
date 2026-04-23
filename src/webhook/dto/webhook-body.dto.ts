import { IsArray, IsOptional, IsString } from 'class-validator';

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
}
