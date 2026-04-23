import {
  Body,
  Controller,
  Logger,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { BiAgentService } from '../bi/bi-agent.service';
import { ApiConfigGuard } from './api-config.guard';
import { WebhookBodyDto } from './dto/webhook-body.dto';

/** Même path que le n8n Webhook (POST /webhook/<uuid path>). */
const N8N_WEBHOOK_PATH = '5a2715bd-0b56-4e05-9c24-eb48e13c5d7a';

@Controller('webhook')
@UseGuards(ApiConfigGuard)
export class WebhookController {
  private readonly log = new Logger(WebhookController.name);

  constructor(private readonly biAgent: BiAgentService) {}

  @Post(N8N_WEBHOOK_PATH)
  async handle(@Body() body: WebhookBodyDto) {
    return this.biAgent.runChat({
      message: body.message,
      chatId: body.chatId,
    });
  }

  /**
   * Même authentification et corps qu’en JSON, mais en NDJSON (une ligne JSON = un événement) pour l’avancement en direct.
   */
  @Post(`${N8N_WEBHOOK_PATH}/stream`)
  async handleStream(
    @Body() body: WebhookBodyDto,
    @Res({ passthrough: false }) res: Response,
  ) {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    /** Permet de vérifier que l’ancien binaire n’est pas exécuté (libellés d’étapes côté stream). */
    res.setHeader('X-Bi-Stream-Version', '3');
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
      const message =
        e instanceof Error ? e.message : 'Erreur inconnue';
      if (!res.headersSent) {
        res.status(500);
      }
      res.write(`${JSON.stringify({ t: 'error' as const, message })}\n`);
      res.end();
    }
  }
}
