import { Module } from '@nestjs/common';
import { BiModule } from '../bi/bi.module';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [BiModule],
  controllers: [WebhookController],
})
export class WebhookModule {}
