import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateConversationDto {
  @IsOptional()
  @IsUUID('4', { message: 'id must be a UUID' })
  id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string | null;
}
