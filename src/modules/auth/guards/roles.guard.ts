import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

export const STAFF_ROLES = ['OPERATOR', 'MANAGER', 'GENERAL_MANAGER', 'ACCOUNTANT'];

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const { user } = req;

    // ── Central Delete Restriction for Staff Roles ──────────────────────────
    // Staff members (OPERATOR, MANAGER, GENERAL_MANAGER, ACCOUNTANT) must NOT be able
    // to DELETE anything across the entire system. Enforced centrally at RBAC level.
    if (req.method === 'DELETE' && user && user.roles) {
      const hasStaffRole = user.roles.some((role: string) => STAFF_ROLES.includes(role));
      const isSuperAdmin = user.roles.includes('SUPER_ADMIN');
      if (hasStaffRole && !isSuperAdmin) {
        throw new ForbiddenException(
          'Staff members are not authorized to perform delete operations.',
        );
      }
    }

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    if (!user) {
      return false;
    }

    const userRoles: string[] = Array.isArray(user.roles)
      ? user.roles
      : user.role
      ? [user.role]
      : [];

    if (userRoles.length === 0) {
      return false;
    }

    // ── SUPER_ADMIN GLOBAL ACCESS ──────────────────────────────────────────
    // Super Admin has global unrestricted access to all admin and role-protected routes.
    if (userRoles.includes('SUPER_ADMIN') || user.isSuperAdmin) {
      return true;
    }

    return requiredRoles.some((role) => userRoles.includes(role));
  }
}
