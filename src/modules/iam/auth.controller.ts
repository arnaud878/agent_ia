import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { AuthLoginDto } from './dto/auth-login.dto';
import { AuthRegisterDto } from './dto/auth-register.dto';
import type { AuthUserPayload } from './iam.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Flags pour le front (inscription, contrainte JWT sur le webhook). */
  @Get('config')
  getConfig() {
    return this.auth.getPublicConfig();
  }

  @Post('login')
  login(@Body() dto: AuthLoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Post('register')
  register(@Body() dto: AuthRegisterDto) {
    return this.auth.register(dto.email, dto.password);
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  me(@Req() req: Request & { user: AuthUserPayload }) {
    return req.user;
  }
}
