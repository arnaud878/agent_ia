import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import type { DataAccess } from '../types/data-access';
import { IamService } from '../../modules/iam/iam.service';

/**
 * 1) Bearer JWT valide → accès selon le rôle utilisateur
 * 2) Sinon `x-api-config` = API_CONFIG_SECRET → accès complet (intégrations / n8n)
 */
@Injectable()
export class WebhookAuthGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly iam: IamService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const jwtOnly =
      this.config.get<string>('WEBHOOK_JWT_ONLY') === 'true' ||
      this.config.get<string>('BI_WEBHOOK_JWT_ONLY') === 'true';
    const auth = req.headers['authorization'];
    if (auth && auth.startsWith('Bearer ')) {
      const token = auth.slice(7).trim();
      if (!token) {
        throw new UnauthorizedException({ message: 'Token manquant' });
      }
      try {
        const payload = await this.jwt.verifyAsync<{ sub: string }>(token, {
          secret: this.config.getOrThrow<string>('JWT_SECRET'),
        });
        const da = await this.iam.getDataAccessForUserId(payload.sub);
        if (!da) {
          throw new UnauthorizedException({
            message: 'Compte ou accès invalide',
          });
        }
        req.dataAccess = da;
        req.authUserId = payload.sub;
        return true;
      } catch (e) {
        if (e instanceof UnauthorizedException) {
          throw e;
        }
        throw new UnauthorizedException({
          message: 'Token invalide ou expiré',
        });
      }
    }
    if (jwtOnly) {
      throw new UnauthorizedException({
        message: 'Authentification JWT requise (WEBHOOK_JWT_ONLY actif)',
      });
    }
    const expected = this.config.get<string>('API_CONFIG_SECRET');
    if (!expected) {
      throw new UnauthorizedException({
        message: 'API non configuré (API_CONFIG_SECRET ou JWT requis)',
      });
    }
    const v = req.headers['x-api-config'];
    if (v !== expected) {
      throw new UnauthorizedException({ message: 'unauthorized token' });
    }
    req.dataAccess = { kind: 'all' } satisfies DataAccess;
    req.authUserId = undefined;
    return true;
  }
}
