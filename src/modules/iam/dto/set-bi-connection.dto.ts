import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { DbType } from '../../../common/db/db-adapter';

export class SetBiConnectionDto {
  @IsString()
  @MaxLength(5000)
  connectionString!: string;

  @IsOptional()
  @IsString()
  @IsIn(['postgresql', 'mysql'])
  dbType?: DbType;
}
