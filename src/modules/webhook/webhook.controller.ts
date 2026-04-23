import { Body, Controller, Logger, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  BI_STREAM_VERSION_HEADER,
  N8N_WEBHOOK_PATH_SEGMENT,
} from '../../common/constants/bi-webhook';
import { BiAgentService } from '../bi/services/bi-agent.service';
import { ApiConfigGuard } from '../../common/guards/api-config.guard';
import { WebhookBodyDto } from './dto/webhook-body.dto';

@Controller('webhook')
@UseGuards(ApiConfigGuard)
export class WebhookController {
  private readonly log = new Logger(WebhookController.name);

  constructor(private readonly biAgent: BiAgentService) {}

  @Post(N8N_WEBHOOK_PATH_SEGMENT)
  async handle(@Body() body: WebhookBodyDto) {
    return this.biAgent.runChat({
      message: body.message,
      chatId: body.chatId,
    });
  }

  /**
   * Même authentification et corps qu’en JSON, mais en NDJSON (une ligne JSON = un événement) pour l’avancement en direct.
   */
  @Post(`${N8N_WEBHOOK_PATH_SEGMENT}/stream`)
  async handleStream(
    @Body() body: WebhookBodyDto,
    @Res({ passthrough: false }) res: Response,
  ) {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('X-Bi-Stream-Version', BI_STREAM_VERSION_HEADER);
    try {
      for await (const ev of this.biAgent.streamChat({
        message: body.message,
        chatId: body.chatId,
      })) {
        res.write(`${JSON.stringify(ev)}\n`);
      }
      res.end();
    } catch (e) {
      this.log.error(e);
      const message = e instanceof Error ? e.message : 'Erreur inconnue';
      if (!res.headersSent) {
        res.status(500);
      }
      res.write(`${JSON.stringify({ t: 'error' as const, message })}\n`);
      res.end();
    }
  }
}
