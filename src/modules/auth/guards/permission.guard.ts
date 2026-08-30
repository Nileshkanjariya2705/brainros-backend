import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no permissions are required, allow access
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user || !user.userId) {
      throw new ForbiddenException('Authentication required.');
    }

    // Load user's permissions from DB via role-permission mappings
    const userPermissions = await this.loadUserPermissions(user.userId);

    // Check if user has all required permissions
    const hasPermission = requiredPermissions.every((perm) =>
      userPermissions.includes(perm),
    );

    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not have the required permissions for this action.',
      );
    }

    // Attach permissions to request for downstream use
    user.permissions = userPermissions;

    return true;
  }

  /**
   * Load all permission codes for a user through their role-permission mappings.
   */
  private async loadUserPermissions(userId: string): Promise<string[]> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId },
      include: {
        role: {
          include: {
            rolePermissions: {
              include: {
                permission: {
                  select: { code: true, isActive: true },
                },
              },
            },
          },
        },
      },
    });

    const permissions = new Set<string>();
    for (const ur of userRoles) {
      if (ur.role.isActive !== false) {
        for (const rp of ur.role.rolePermissions) {
          if (rp.permission.isActive) {
            permissions.add(rp.permission.code);
          }
        }
      }
    }

    return Array.from(permissions);
  }
}
