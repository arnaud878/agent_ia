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
import { SetBiTablesDto } from './dto/set-bi-tables.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { SetRoleTablesDto } from './dto/set-role-tables.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { IamService, type AuthUserPayload } from './iam.service';

@Controller('iam')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin')
export class RbacController {
  constructor(private readonly iam: IamService) {}

  @Get('bi-tables')
  biTableNames() {
    return { tables: this.iam.allBiTableNamesForDocs() };
  }

  @Put('bi-tables')
  setBiTableNames(@Body() dto: SetBiTablesDto) {
    return this.iam.setBiTableNames(dto.tableNames);
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
