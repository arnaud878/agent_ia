import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateRoleDto } from './dto/create-role.dto';
import { SetBiConnectionDto } from './dto/set-bi-connection.dto';
import { SetBiTablesDto } from './dto/set-bi-tables.dto';
import { SetAgentPromptDto } from './dto/set-agent-prompt.dto';
import { SetLlmSettingsDto } from './dto/set-llm-settings.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { SetRoleTablesDto } from './dto/set-role-tables.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { BiAgentPromptStoreService } from '../bi/services/bi-agent-prompt-store.service';
import { IamService, type AuthUserPayload } from './iam.service';

@Controller('iam')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin')
export class RbacController {
  constructor(
    private readonly iam: IamService,
    private readonly agentPrompts: BiAgentPromptStoreService,
  ) {}

  @Get('bi-tables')
  biTableNames() {
    return { tables: this.iam.allBiTableNamesForDocs() };
  }

  @Put('bi-tables')
  setBiTableNames(@Body() dto: SetBiTablesDto) {
    return this.iam.setBiTableNames(dto.tableNames);
  }

  @Get('bi-tables/available')
  getAvailableBiTables() {
    return this.iam.getAvailableBiTables();
  }

  @Get('bi-connection')
  getBiConnection() {
    return this.iam.getBiConnection();
  }

  @Put('bi-connection')
  setBiConnection(@Body() dto: SetBiConnectionDto) {
    return this.iam.setBiConnection(
      dto.connectionString,
      dto.dbType ?? 'postgresql',
    );
  }

  @Get('llm-settings')
  getLlmSettings() {
    return this.iam.getLlmSettings();
  }

  @Put('llm-settings')
  setLlmSettings(@Body() dto: SetLlmSettingsDto) {
    return this.iam.setLlmSettings({
      provider: dto.provider,
      model: dto.model,
      apiKey: dto.apiKey,
    });
  }

  @Get('agent-prompts')
  listAgentPrompts() {
    return this.agentPrompts.listPromptsWithSource();
  }

  @Get('agent-prompts/:id')
  getAgentPrompt(@Param('id') id: string) {
    return this.agentPrompts.getPromptDetail(id);
  }

  @Put('agent-prompts/:id')
  async setAgentPrompt(
    @Param('id') id: string,
    @Body() dto: SetAgentPromptDto,
  ) {
    await this.agentPrompts.setPromptBody(id, dto.body ?? null);
    return { ok: true as const };
  }

  @Get('roles')
  listRoles() {
    return this.iam.listRoles();
  }

  @Post('roles')
  createRole(@Body() dto: CreateRoleDto) {
    return this.iam.createRole(
      dto.name,
      dto.slug,
      dto.accessAllTables,
      dto.description ?? null,
    );
  }

  @Put('roles/:roleId/tables')
  setTables(
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() dto: SetRoleTablesDto,
  ) {
    return this.iam.setRoleTables(roleId, dto.tableNames);
  }

  @Get('users')
  listUsers() {
    return this.iam.listUsers();
  }

  @Post('users')
  createUser(@Body() dto: CreateUserDto) {
    return this.iam.createUser(dto.email, dto.password, dto.roleId);
  }

  @Put('users/:userId')
  updateUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateUserDto,
    @Req() req: Request & { user: AuthUserPayload },
  ) {
    return this.iam.updateUser(
      userId,
      { roleId: dto.roleId, active: dto.active, password: dto.password },
      req.user.id,
    );
  }
}
