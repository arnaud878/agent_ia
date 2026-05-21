import { Global, Module } from '@nestjs/common';
import { AppDbService } from './app-db.service';

@Global()
@Module({
  providers: [AppDbService],
  exports: [AppDbService],
})
export class AppDbModule {}
