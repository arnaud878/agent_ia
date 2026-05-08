import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { BiModule } from '../bi/bi.module';
import { AdminConversationsController } from './admin-conversations.controller';
import { AdminConversationsService } from './admin-conversations.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { IamService } from './iam.service';
import { JwtStrategy } from './jwt.strategy';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { RbacController } from './rbac.controller';

@Module({
  imports: [
    BiModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        secret: c.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [AuthController, RbacController, ConversationsController, AdminConversationsController],
  providers: [IamService, AuthService, JwtStrategy, RolesGuard, ConversationsService, AdminConversationsService],
  exports: [IamService, AuthService, JwtModule],
})
export class IamModule {}
