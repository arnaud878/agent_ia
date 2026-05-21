import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppDbModule } from './common/db/app-db.module';
import { BiDataTablesModule } from './common/bi-tables/bi-data-tables.module';
import { IamModule } from './modules/iam/iam.module';
import { WebhookModule } from './modules/webhook/webhook.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
    }),
    AppDbModule,
    BiDataTablesModule,
    IamModule,
    WebhookModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
