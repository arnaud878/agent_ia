import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9_-]+$/)
  @Length(1, 100)
  slug!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsBoolean()
  accessAllTables!: boolean;
}
