import { Global, Module } from '@nestjs/common';
import { BiDataTablesService } from './bi-data-tables.service';

@Global()
@Module({
  providers: [BiDataTablesService],
  exports: [BiDataTablesService],
})
export class BiDataTablesModule {}
