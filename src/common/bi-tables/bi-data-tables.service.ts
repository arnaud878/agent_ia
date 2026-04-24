import { Injectable } from '@nestjs/common';
import {
  ALL_BI_DATA_TABLES,
  isBiDataTable,
} from '../constants/bi-data-tables';

/**
 * Registre unique des tables d’analyse BI (allowlist) — un seul endroit
 * injectable (tests, évolution future ex. table dynamique filtrée).
 */
@Injectable()
export class BiDataTablesService {
  getAllTableNames(): readonly string[] {
    return ALL_BI_DATA_TABLES;
  }

  isBiDataTableName(name: string): boolean {
    return isBiDataTable(name);
  }
}
