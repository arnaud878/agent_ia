import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { AppendUiMessageDto } from './dto/append-ui-message.dto';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { PatchConversationDto } from './dto/patch-conversation.dto';
import type { AuthUserPayload } from './iam.service';
import {
  ConversationsService,
  type ConversationRow,
  type UiMessageRow,
} from './conversations.service';

@Controller('iam')
@UseGuards(AuthGuard('jwt'))
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

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
}
