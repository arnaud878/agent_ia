import { Module } from '@nestjs/common';
import { WebhookAuthGuard } from '../../common/guards/webhook-auth.guard';
import { IamModule } from '../iam/iam.module';
import { BiModule } from '../bi/bi.module';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [BiModule, IamModule],
  controllers: [WebhookController],
  providers: [WebhookAuthGuard],
})
export class WebhookModule {}
