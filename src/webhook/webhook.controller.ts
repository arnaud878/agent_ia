import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { BiAgentService } from '../bi/bi-agent.service';
import { ApiConfigGuard } from './api-config.guard';
import { WebhookBodyDto } from './dto/webhook-body.dto';

/** Même path que le n8n Webhook (POST /webhook/<uuid path>). */
const N8N_WEBHOOK_PATH = '5a2715bd-0b56-4e05-9c24-eb48e13c5d7a';

@Controller('webhook')
@UseGuards(ApiConfigGuard)
export class WebhookController {
  constructor(private readonly biAgent: BiAgentService) {}

  @Post(N8N_WEBHOOK_PATH)
  async handle(@Body() body: WebhookBodyDto) {
    return this.biAgent.runChat({
      message: body.message,
      chatId: body.chatId,
    });
  }
}
