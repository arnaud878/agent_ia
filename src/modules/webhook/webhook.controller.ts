import {
  Body,
  Controller,
  HttpException,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  BI_STREAM_VERSION_HEADER,
  N8N_WEBHOOK_PATH_SEGMENT,
} from '../../common/constants/bi-webhook';
import { WebhookAuthGuard } from '../../common/guards/webhook-auth.guard';
import type { DataAccess } from '../../common/types/data-access';
import { BiAgentService } from '../bi/services/bi-agent.service';
import { ConversationAttachmentsService } from '../iam/conversation-attachments.service';
import { WebhookBodyDto } from './dto/webhook-body.dto';

function streamErrorMessage(e: unknown): string {
  if (e instanceof HttpException) {
    const r = e.getResponse();
    if (typeof r === 'string') {
      return r;
    }
    if (r && typeof r === 'object' && 'message' in r) {
      const m = (r as { message: string | string[] }).message;
      return Array.isArray(m) ? (m[0] ?? e.message) : m;
    }
  }
  return e instanceof Error ? e.message : 'Erreur inconnue';
}

@Controller('webhook')
@UseGuards(WebhookAuthGuard)
export class WebhookController {
  private readonly log = new Logger(WebhookController.name);

  constructor(
    private readonly biAgent: BiAgentService,
    private readonly attachments: ConversationAttachmentsService,
  ) {}

  private async enrichMessageWithAttachments(
    req: Request,
    body: WebhookBodyDto,
  ): Promise<{ message: string; statusLine: string | null }> {
    const ids = body.attachmentIds ?? [];
    if (!ids.length) {
      return { message: body.message, statusLine: null };
    }
    const userId = req.authUserId;
    if (!userId) {
      return { message: body.message, statusLine: null };
    }
    const context = await this.attachments.buildContextForPrompt({
      userId,
      conversationId: body.chatId,
      attachmentIds: ids,
      query: body.message,
    });
    if (!context) {
      return {
        message: `${body.message}

[CONSIGNE_FICHIER]
Des fichiers sont bien joints à cette demande, mais aucun extrait n'est disponible.
Ne dis jamais "fichier non fourni". Indique plutôt qu'il faut extraction avancée/OCR pour analyse détaillée.
[/CONSIGNE_FICHIER]`,
        statusLine: `Lecture de ${ids.length} fichier(s) joint(s)…`,
      };
    }
    return {
      message: `${body.message}

[CONSIGNE_FICHIER]
Les fichiers joints sont disponibles et les extraits ci-dessous sont fournis.
Analyse ces extraits directement dans ta réponse. Ne dis jamais que le fichier est absent/non fourni.
[/CONSIGNE_FICHIER]

${context}`,
      statusLine: `Lecture de ${ids.length} fichier(s) joint(s)…`,
    };
  }

  @Post(N8N_WEBHOOK_PATH_SEGMENT)
  async handle(@Body() body: WebhookBodyDto, @Req() req: Request) {
    const dataAccess = req.dataAccess as DataAccess;
    const prep = await this.enrichMessageWithAttachments(req, body);
    return this.biAgent.runChat({
      message: prep.message,
      chatId: body.chatId,
      dataAccess,
      responseMode: body.responseMode,
    });
  }

  /**
   * Même authentification et corps qu’en JSON, mais en NDJSON (une ligne JSON = un événement) pour l’avancement en direct.
   */
  @Post(`${N8N_WEBHOOK_PATH_SEGMENT}/stream`)
  async handleStream(
    @Body() body: WebhookBodyDto,
    @Req() req: Request,
    @Res({ passthrough: false }) res: Response,
  ) {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('X-Bi-Stream-Version', BI_STREAM_VERSION_HEADER);
    const dataAccess = req.dataAccess as DataAccess;
    try {
      const prep = await this.enrichMessageWithAttachments(req, body);
      if (prep.statusLine) {
        res.write(`${JSON.stringify({ t: 'status' as const, m: prep.statusLine })}\n`);
      }
      for await (const ev of this.biAgent.streamChat({
        message: prep.message,
        chatId: body.chatId,
        dataAccess,
        responseMode: body.responseMode,
      })) {
        res.write(`${JSON.stringify(ev)}\n`);
      }
      res.end();
    } catch (e) {
      this.log.error(e);
      const status = e instanceof HttpException ? e.getStatus() : 500;
      const message = streamErrorMessage(e);
      if (!res.headersSent) {
        res.status(status);
      }
      res.write(`${JSON.stringify({ t: 'error' as const, message })}\n`);
      res.end();
    }
  }
}
