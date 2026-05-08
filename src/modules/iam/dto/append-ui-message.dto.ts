import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class AppendUiMessageDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  text?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500_000)
  html?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationMs?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(50_000)
  requeteSQL?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  resultatSQL?: string | null;
}
