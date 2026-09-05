import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { OtpService } from './services/otp.service';
import { TokenService } from './services/token.service';
import { PasswordService } from './services/password.service';
import { SessionService } from './services/session.service';
import { OAuthService } from './services/oauth.service';
import { SecurityEventService } from './services/security-event.service';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TwoFactorProvider } from './otp/two-factor.provider';

import { TwoFactorDotInProvider } from './two-factor/two-factor-dot-in.provider';
import { DevelopmentOtpProvider } from './two-factor/development-otp.provider';
import { TwoFactorService } from './two-factor/two-factor.service';
import { TwoFactorConfig } from './config/two-factor.config';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret:
        process.env.JWT_SECRET || 'super-secret-jwt-key-replace-in-production',
      signOptions: { expiresIn: '15m' },
    }),
    RedisModule,
  ],
  controllers: [AuthController],
  providers: [
    TwoFactorConfig,

    TwoFactorDotInProvider,
    DevelopmentOtpProvider,
    TwoFactorService,
    OtpService,
    AuthService,
    TokenService,
    PasswordService,
    SessionService,
    OAuthService,
    SecurityEventService,
    JwtStrategy,
    TwoFactorProvider,
  ],
  exports: [
    AuthService,
    PassportModule,
    JwtModule,
    SecurityEventService,
    SessionService,
    TokenService,
    TwoFactorConfig,
    TwoFactorService,
    OtpService,
    TwoFactorDotInProvider,
  ],
})
export class AuthModule {}
