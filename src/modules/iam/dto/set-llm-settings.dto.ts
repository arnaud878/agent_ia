import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class SetLlmSettingsDto {
  @IsIn(['gemini', 'gpt', 'claude'])
  provider!: 'gemini' | 'gpt' | 'claude';

  @IsString()
  @MaxLength(120)
  model!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  apiKey?: string;
}

