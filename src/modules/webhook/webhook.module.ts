import { Module } from '@nestjs/common';
import { BiModule } from '../bi/bi.module';
import { ApiConfigGuard } from '../../common/guards/api-config.guard';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [BiModule],
  controllers: [WebhookController],
  providers: [ApiConfigGuard],
})
export class WebhookModule {}
