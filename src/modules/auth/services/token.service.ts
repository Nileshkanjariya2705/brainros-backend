import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Generates a random secure refresh token string
   */
  private generateRandomToken(): string {
    return crypto.randomBytes(40).toString('hex');
  }

  /**
   * Hashes a refresh token string using SHA-256
   */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Generates both Access Token (JWT) and Refresh Token (stored in DB)
   */
  async generateTokens(userId: string, roles: string[]) {
    // 1. Generate JWT Access Token
    const payload = { sub: userId, roles };
    const accessToken = this.jwtService.sign(payload);

    // 2. Generate Refresh Token
    const rawRefreshToken = this.generateRandomToken();
    const tokenHash = this.hashToken(rawRefreshToken);

    // Set Refresh Token Expiry (e.g. 7 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // 3. Save Refresh Token Hash to Database
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
    };
  }

  /**
   * Uses a refresh token to generate a new pair of access and refresh tokens
   */
  async refreshAccessTokens(rawRefreshToken: string) {
    const tokenHash = this.hashToken(rawRefreshToken);

    // 1. Retrieve refresh token from database
    const dbToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: {
            userRoles: {
              include: {
                role: true,
              },
            },
          },
        },
      },
    });

    if (!dbToken) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    // 2. Check if token is expired or revoked
    if (new Date() > dbToken.expiresAt) {
      // Clean up expired token
      await this.prisma.refreshToken.delete({ where: { id: dbToken.id } });
      throw new UnauthorizedException('Refresh token has expired.');
    }

    if (dbToken.revokedAt) {
      throw new UnauthorizedException('Refresh token has been revoked.');
    }

    // 3. Revoke this token (Refresh Token Rotation)
    await this.prisma.refreshToken.update({
      where: { id: dbToken.id },
      data: { revokedAt: new Date() },
    });

    // 4. Retrieve user roles
    const roles = dbToken.user.userRoles.map((ur) => ur.role.name);

    // 5. Generate a brand new token pair
    return this.generateTokens(dbToken.userId, roles);
  }

  /**
   * Revokes a refresh token (used for logout)
   */
  async revokeRefreshToken(rawRefreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawRefreshToken);

    const dbToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (dbToken) {
      await this.prisma.refreshToken.update({
        where: { id: dbToken.id },
        data: { revokedAt: new Date() },
      });
    }
  }
}
