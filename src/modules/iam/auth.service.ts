import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { IamService } from './iam.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly iam: IamService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.iam.validateUser(email, password);
    if (!user) {
      throw new UnauthorizedException('Identifiants invalides');
    }
    const dataAccess = await this.iam.getDataAccessForUserId(user.id);
    if (!dataAccess) {
      throw new UnauthorizedException('Compte inactif ou sans accès');
    }
    const access_token = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
    });
    return {
      access_token,
      user: {
        id: user.id,
        email: user.email,
        roleSlug: user.roleSlug,
        dataAccess,
      },
    };
  }

  getPublicConfig() {
    return {
      publicRegister: this.config.get<string>('AUTH_PUBLIC_REGISTER') === 'true',
      webhookJwtOnly:
        this.config.get<string>('WEBHOOK_JWT_ONLY') === 'true' ||
        this.config.get<string>('BI_WEBHOOK_JWT_ONLY') === 'true',
    };
  }

  /**
   * Inscription publique (désactivée par défaut : AUTH_PUBLIC_REGISTER=true requis).
   * Rôle par défaut : REGISTER_DEFAULT_ROLE_SLUG (défaut : user) — jamais admin.
   */
  async register(email: string, password: string) {
    if (this.config.get<string>('AUTH_PUBLIC_REGISTER') !== 'true') {
      throw new ForbiddenException('Inscription publique désactivée');
    }
    const roleSlug = (
      this.config.get<string>('REGISTER_DEFAULT_ROLE_SLUG') || 'user'
    ).trim();
    if (roleSlug === 'admin') {
      throw new BadRequestException('Rôle interdit pour l’inscription');
    }
    const roleId = await this.iam.findRoleIdBySlug(roleSlug);
    if (!roleId) {
      throw new BadRequestException(`Rôle « ${roleSlug} » introuvable en base`);
    }
    await this.iam.createUser(email, password, roleId);
    return this.login(email, password);
  }
}
