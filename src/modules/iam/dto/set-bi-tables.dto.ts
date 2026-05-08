import { ArrayMinSize, IsArray, IsString, Matches } from 'class-validator';

export class SetBiTablesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @Matches(/^[a-zA-Z_][a-zA-Z0-9_]*$/, {
    each: true,
    message:
      'Chaque table doit respecter le format SQL simple: lettre/underscore puis alphanumérique/underscore.',
  })
  tableNames!: string[];
}
