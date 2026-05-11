import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { AppendUiMessageDto } from './dto/append-ui-message.dto';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { PatchConversationDto } from './dto/patch-conversation.dto';
import { ConversationAttachmentsService, type ConversationAttachmentRow } from './conversation-attachments.service';
import type { AuthUserPayload } from './iam.service';
import {
  ConversationsService,
  type ConversationRow,
  type UiMessageRow,
} from './conversations.service';

@Controller('iam')
@UseGuards(AuthGuard('jwt'))
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly attachments: ConversationAttachmentsService,
  ) {}

  @Get('conversations')
  list(@Req() req: Request & { user: AuthUserPayload }): Promise<
    ConversationRow[]
  > {
    return this.conversations.listForUser(req.user.id);
  }

  @Post('conversations')
  create(
    @Body() body: CreateConversationDto,
    @Req() req: Request & { user: AuthUserPayload },
  ): Promise<ConversationRow> {
    return this.conversations.upsert(req.user.id, body);
  }

  @Get('conversations/:id/messages')
  async getMessages(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user: AuthUserPayload },
  ): Promise<{ messages: UiMessageRow[] }> {
    const messages = await this.conversations.loadMessagesForOwner(
      req.user.id,
      id,
    );
    return { messages };
  }

  @Post('conversations/:id/messages')
  async postMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AppendUiMessageDto,
    @Req() req: Request & { user: AuthUserPayload },
  ): Promise<{ id: string }> {
    return this.conversations.appendUiMessage(req.user.id, id, {
      role: body.role,
      text: body.text,
      html: body.html,
      durationMs: body.durationMs,
      requeteSQL: body.requeteSQL,
      resultatSQL: body.resultatSQL,
    });
  }

  @Patch('conversations/:id')
  patch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PatchConversationDto,
    @Req() req: Request & { user: AuthUserPayload },
  ): Promise<ConversationRow> {
    const payload: { title?: string | null } = {}
    if (body.title !== undefined) {
      payload.title = body.title
    }
    return this.conversations.patch(req.user.id, id, payload);
  }

  @Delete('conversations/:id')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user: AuthUserPayload },
  ): Promise<{ ok: true }> {
    await this.conversations.remove(req.user.id, id);
    return { ok: true };
  }

  @Get('conversations/:id/attachments')
  listAttachments(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user: AuthUserPayload },
  ): Promise<ConversationAttachmentRow[]> {
    return this.attachments.listForConversation(req.user.id, id);
  }

  @Post('conversations/:id/attachments')
  @UseInterceptors(FileInterceptor('file'))
  uploadAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file:
      | {
          size: number;
          mimetype: string;
          originalname: string;
          buffer: Buffer;
        }
      | undefined,
    @Req() req: Request & { user: AuthUserPayload },
  ): Promise<ConversationAttachmentRow> {
    return this.attachments.createForConversation(req.user.id, id, file);
  }

  @Delete('conversations/:id/attachments/:attachmentId')
  @HttpCode(204)
  async removeAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Req() req: Request & { user: AuthUserPayload },
  ): Promise<void> {
    await this.attachments.removeForConversation(req.user.id, id, attachmentId);
  }
}
