import {
  Injectable,
  BadRequestException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SecurityEventService } from './security-event.service';
import { OAuth2Client } from 'google-auth-library';

export interface GoogleUserInfo {
  sub: string; // Google unique user ID
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);
  private readonly googleClient: OAuth2Client;
  private readonly googleClientId: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly securityEventService: SecurityEventService,
  ) {
    this.googleClientId =
      this.configService.get<string>('GOOGLE_CLIENT_ID') || '';
    this.googleClient = new OAuth2Client(this.googleClientId);
  }

  /**
   * Verify a Google ID token and extract user information.
   * Validates issuer, audience, signature, and expiration.
   */
  async verifyGoogleIdToken(idToken: string): Promise<GoogleUserInfo> {
    if (!this.googleClientId) {
      throw new BadRequestException('Google authentication is not configured.');
    }

    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: this.googleClientId,
      });

      const payload = ticket.getPayload();
      if (!payload) {
        throw new UnauthorizedException('Invalid Google ID token payload.');
      }

      if (!payload.sub) {
        throw new UnauthorizedException(
          'Invalid Google ID token: missing subject.',
        );
      }

      return {
        sub: payload.sub,
        email: payload.email || '',
        emailVerified: payload.email_verified || false,
        name: payload.name,
        picture: payload.picture,
      };
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.logger.warn(
        `Google ID token verification failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new UnauthorizedException('Invalid or expired Google ID token.');
    }
  }

  /**
   * Find or create a user via Google OIDC identity.
   * Implements account linking: if a user with the same verified email exists,
   * link the Google identity to that user (only if email is verified on both sides).
   */
  async findOrCreateGoogleUser(
    googleInfo: GoogleUserInfo,
    requestContext?: { ipAddress?: string; userAgent?: string },
  ): Promise<{ user: any; isNewUser: boolean }> {
    // 1. Check if external identity already exists
    const existingIdentity = await this.prisma.externalIdentity.findUnique({
      where: {
        provider_providerSubject: {
          provider: 'GOOGLE',
          providerSubject: googleInfo.sub,
        },
      },
      include: {
        user: {
          include: {
            userRoles: { include: { role: true } },
            student: true,
          },
        },
      },
    });

    if (existingIdentity) {
      // Existing Google-linked user
      return { user: existingIdentity.user, isNewUser: false };
    }

    // 2. Check if user with same verified email already exists (account linking)
    if (googleInfo.email && googleInfo.emailVerified) {
      const existingEmailUser = await this.prisma.user.findUnique({
        where: { email: googleInfo.email.toLowerCase().trim() },
        include: {
          userRoles: { include: { role: true } },
          student: true,
        },
      });

      if (existingEmailUser) {
        // Only link if the existing user's email is also verified
        if (existingEmailUser.emailVerifiedAt || existingEmailUser.isVerified) {
          // Link Google identity to existing user
          await this.prisma.externalIdentity.create({
            data: {
              userId: existingEmailUser.id,
              provider: 'GOOGLE',
              providerSubject: googleInfo.sub,
              email: googleInfo.email.toLowerCase().trim(),
            },
          });

          // Log account linking event
          await this.securityEventService.log('GOOGLE_LINKED', {
            userId: existingEmailUser.id,
            ipAddress: requestContext?.ipAddress,
            userAgent: requestContext?.userAgent,
            metadata: {
              providerSubject: googleInfo.sub,
              email: googleInfo.email,
            },
          });

          return { user: existingEmailUser, isNewUser: false };
        }
      }
    }

    // 3. Create a new user with Google identity
    const result = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: googleInfo.email
            ? googleInfo.email.toLowerCase().trim()
            : null,
          status: 'ACTIVE',
          isActive: true,
          isVerified: true,
          emailVerifiedAt: googleInfo.emailVerified ? new Date() : null,
        },
      });

      // Create external identity
      await tx.externalIdentity.create({
        data: {
          userId: newUser.id,
          provider: 'GOOGLE',
          providerSubject: googleInfo.sub,
          email: googleInfo.email
            ? googleInfo.email.toLowerCase().trim()
            : null,
        },
      });

      // Assign STUDENT role by default
      let studentRole = await tx.role.findUnique({
        where: { name: 'STUDENT' },
      });
      if (!studentRole) {
        studentRole = await tx.role.create({ data: { name: 'STUDENT' } });
      }

      await tx.userRole.create({
        data: { userId: newUser.id, roleId: studentRole.id },
      });

      return tx.user.findUnique({
        where: { id: newUser.id },
        include: {
          userRoles: { include: { role: true } },
          student: true,
        },
      });
    });

    // Log security event
    await this.securityEventService.log('GOOGLE_LINKED', {
      userId: result?.id,
      ipAddress: requestContext?.ipAddress,
      userAgent: requestContext?.userAgent,
      metadata: {
        providerSubject: googleInfo.sub,
        email: googleInfo.email,
        newUser: true,
      },
    });

    return { user: result, isNewUser: true };
  }
}
