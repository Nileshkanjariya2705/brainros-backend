import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'super-secret-jwt-key-replace-in-production',
    });
  }

  async validate(payload: { sub: string; roles: string[] }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { student: { select: { id: true } } },
    });

    if (!user) {
      throw new UnauthorizedException('User no longer exists.');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('User account is inactive.');
    }

    return {
      userId: payload.sub,
      roles: payload.roles,
      studentId: user.student?.id ?? null,
    };
  }
}

