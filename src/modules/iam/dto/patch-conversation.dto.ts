import { IsOptional, IsString, MaxLength } from 'class-validator';

export class PatchConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string | null;
}
