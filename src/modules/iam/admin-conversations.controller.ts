import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  AdminConversationsService,
  type AdminConversationRow,
  type AdminMessageRow,
  type PaginatedResult,
  type TurnRow,
} from './admin-conversations.service';

@Controller('iam/admin')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin')
export class AdminConversationsController {
  constructor(
    private readonly adminConversations: AdminConversationsService,
  ) {}

  @Get('turns')
  listTurns(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ): Promise<PaginatedResult<TurnRow>> {
    return this.adminConversations.listTurns({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      search: search || undefined,
    });
  }

  @Get('conversations')
  listConversations(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('userId') userId?: string,
  ): Promise<PaginatedResult<AdminConversationRow>> {
    return this.adminConversations.listConversations({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      search: search || undefined,
      userId: userId || undefined,
    });
  }

  @Get('messages')
  listMessages(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('role') role?: string,
  ): Promise<PaginatedResult<AdminMessageRow>> {
    return this.adminConversations.listAllMessages({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      search: search || undefined,
      role: role === 'user' || role === 'assistant' ? role : undefined,
    });
  }

  @Get('conversations/:id/messages')
  getMessages(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminMessageRow[]> {
    return this.adminConversations.getMessages(id);
  }

  @Delete('conversations/:id')
  async removeConversation(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ ok: true }> {
    await this.adminConversations.removeConversation(id);
    return { ok: true };
  }
}
