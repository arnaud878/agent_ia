import { IsArray, IsString } from 'class-validator';

export class SetRoleTablesDto {
  @IsArray()
  @IsString({ each: true })
  tableNames!: string[];
}
