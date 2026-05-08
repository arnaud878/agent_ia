import { IsString, MaxLength } from 'class-validator';

export class SetBiConnectionDto {
  @IsString()
  @MaxLength(5000)
  connectionString!: string;
}

