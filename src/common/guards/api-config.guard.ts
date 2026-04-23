import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class ApiConfigGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('API_CONFIG_SECRET');
    if (!expected) {
      throw new UnauthorizedException({
        status: 401,
        message: 'API non configuré (API_CONFIG_SECRET manquant)',
      });
    }
    const req = context.switchToHttp().getRequest<Request>();
    const v = req.headers['x-api-config'];
    if (v !== expected) {
      throw new UnauthorizedException({
        status: 401,
        message: 'unauthorized token',
      });
    }
    return true;
  }
}
