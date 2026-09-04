import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AdminStudentsQueryDto,
  AddStudentParentDto,
  SortOrderEnum,
} from '../dto/admin-students.dto';
import { Prisma, StudentStatus, ParentLinkStatus, ParentRelationshipType } from '@prisma/client';

@Injectable()
export class AdminStudentsService {
  private readonly logger = new Logger(AdminStudentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Safe server-side paginated, filtered, sorted student directory query
   */
  async getStudents(query: AdminStudentsQueryDto, actorUserId: string) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const skip = (page - 1) * pageSize;

    // 1. RBAC & Institution Scope Evaluation
    const user = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      include: {
        userRoles: { include: { role: true } },
        institutionAdmins: { where: { isActive: true } },
      },
    });

    const isSuperAdmin = user?.userRoles?.some(
      (ur) => ur.role.name === 'SUPER_ADMIN',
    );

    // If regular Admin has assigned institutions, scope to their institutions
    const assignedInstitutionIds =
      user?.institutionAdmins?.map((ia) => ia.institutionId) || [];

    const where: Prisma.StudentWhereInput = {};

    // Apply institution scope if regular admin is bound to specific institutions
    if (!isSuperAdmin && assignedInstitutionIds.length > 0) {
      where.batchMemberships = {
        some: {
          batch: {
            institutionId: { in: assignedInstitutionIds },
          },
        },
      };
    }

    // 2. Build Filter Criteria
    if (query.status) {
      where.status = query.status as StudentStatus;
    }

    if (query.classId) {
      where.classId = query.classId;
    }

    if (query.examTargetId) {
      where.examTargetId = query.examTargetId;
    }

    if (query.stateId) {
      where.stateId = query.stateId;
    }

    if (query.districtId) {
      where.districtId = query.districtId;
    }

    if (query.institutionId) {
      where.batchMemberships = {
        some: {
          batch: {
            institutionId: query.institutionId,
          },
        },
      };
    }

    if (query.createdFrom || query.createdTo) {
      where.createdAt = {};
      if (query.createdFrom) {
        where.createdAt.gte = new Date(query.createdFrom);
      }
      if (query.createdTo) {
        const toDate = new Date(query.createdTo);
        toDate.setHours(23, 59, 59, 999);
        where.createdAt.lte = toDate;
      }
    }

    // 3. Server-side Search
    if (query.search && query.search.trim().length > 0) {
      const searchTerm = query.search.trim();
      where.OR = [
        { name: { contains: searchTerm, mode: 'insensitive' } },
        { studentId: { contains: searchTerm, mode: 'insensitive' } },
        { studentCode: { contains: searchTerm, mode: 'insensitive' } },
        { schoolCollege: { contains: searchTerm, mode: 'insensitive' } },
        {
          user: {
            OR: [
              { email: { contains: searchTerm, mode: 'insensitive' } },
              { mobileNumber: { contains: searchTerm, mode: 'insensitive' } },
              { phone: { contains: searchTerm, mode: 'insensitive' } },
            ],
          },
        },
      ];
    }

    // 4. Safe Whitelisted Sorting
    const sortOrder = query.sortOrder === SortOrderEnum.ASC ? 'asc' : 'desc';
    let orderBy: Prisma.StudentOrderByWithRelationInput = {
      createdAt: 'desc',
    };

    switch (query.sortBy) {
      case 'name':
        orderBy = { name: sortOrder };
        break;
      case 'studentId':
        orderBy = { studentId: sortOrder };
        break;
      case 'status':
        orderBy = { status: sortOrder };
        break;
      case 'schoolCollege':
        orderBy = { schoolCollege: sortOrder };
        break;
      case 'email':
        orderBy = { user: { email: sortOrder } };
        break;
      case 'createdAt':
      default:
        orderBy = { createdAt: sortOrder };
        break;
    }

    // 5. Execute Efficient Parallel Queries (Zero N+1)
    const [students, total] = await Promise.all([
      this.prisma.student.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        select: {
          id: true,
          studentId: true,
          studentCode: true,
          name: true,
          state: true,
          district: true,
          schoolCollege: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              id: true,
              email: true,
              mobileNumber: true,
              phone: true,
              status: true,
              isActive: true,
            },
          },
          studentClass: {
            select: {
              id: true,
              name: true,
            },
          },
          examTarget: {
            select: {
              id: true,
              name: true,
            },
          },
          stateRef: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          districtRef: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          batchMemberships: {
            where: { status: 'ACTIVE' },
            select: {
              id: true,
              batch: {
                select: {
                  id: true,
                  name: true,
                  institution: {
                    select: {
                      id: true,
                      name: true,
                      code: true,
                    },
                  },
                },
              },
            },
          },
          parentLinks: {
            where: { status: 'ACTIVE' },
            select: {
              id: true,
              parentId: true,
              relationshipType: true,
            },
          },
        },
      }),
      this.prisma.student.count({ where }),
    ]);

    // 6. Format Clean Response DTOs
    const items = students.map((s) => {
      const institutions = s.batchMemberships
        .map((bm) => ({
          id: bm.batch.institution.id,
          name: bm.batch.institution.name,
          code: bm.batch.institution.code,
          batchName: bm.batch.name,
        }))
        .filter(
          (inst, idx, self) =>
            idx === self.findIndex((t) => t.id === inst.id),
        );

      return {
        id: s.id,
        studentId: s.studentId,
        studentCode: s.studentCode || s.studentId,
        name: s.name,
        email: s.user?.email || '—',
        mobile: s.user?.mobileNumber || s.user?.phone || '—',
        schoolCollege: s.schoolCollege || '—',
        state: s.stateRef ? { id: s.stateRef.id, name: s.stateRef.name, code: s.stateRef.code } : { name: s.state },
        district: s.districtRef ? { id: s.districtRef.id, name: s.districtRef.name, code: s.districtRef.code } : { name: s.district },
        class: s.studentClass ? { id: s.studentClass.id, name: s.studentClass.name } : null,
        examTarget: s.examTarget ? { id: s.examTarget.id, name: s.examTarget.name } : null,
        institutions,
        status: s.status,
        createdAt: s.createdAt,
        parentsCount: s.parentLinks.length,
        hasParent: s.parentLinks.length > 0,
      };
    });

    return {
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize) || 1,
      },
    };
  }

  /**
   * Fetch dynamic master data filter options
   */
  async getFilterOptions() {
    const [states, districts, classes, examTargets, institutions] =
      await Promise.all([
        this.prisma.state.findMany({
          where: { isActive: true },
          select: { id: true, name: true, code: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.district.findMany({
          where: { isActive: true },
          select: { id: true, name: true, code: true, stateId: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.studentClass.findMany({
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.examTarget.findMany({
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.institution.findMany({
          where: { status: { in: ['ACTIVE', 'APPROVED'] } },
          select: { id: true, name: true, code: true },
          orderBy: { name: 'asc' },
        }),
      ]);

    return {
      states,
      districts,
      classes,
      examTargets,
      institutions,
      statuses: [
        { label: 'Active', value: 'ACTIVE' },
        { label: 'Pending', value: 'PENDING' },
        { label: 'Suspended', value: 'SUSPENDED' },
        { label: 'Inactive', value: 'INACTIVE' },
        { label: 'Archived', value: 'ARCHIVED' },
      ],
    };
  }

  /**
   * Get all linked parents for a specific student
   */
  async getStudentParents(studentId: string) {
    const student = await this.prisma.student.findFirst({
      where: {
        OR: [{ id: studentId }, { studentId: studentId }],
      },
      select: {
        id: true,
        studentId: true,
        studentCode: true,
        name: true,
      },
    });

    if (!student) {
      throw new NotFoundException(`Student with ID '${studentId}' was not found.`);
    }

    const parentLinks = await this.prisma.parentStudentLink.findMany({
      where: { studentId: student.id },
      include: {
        parent: {
          select: {
            id: true,
            email: true,
            mobileNumber: true,
            phone: true,
            isActive: true,
            status: true,
          },
        },
      },
      orderBy: { linkedAt: 'desc' },
    });

    return {
      student: {
        id: student.id,
        studentId: student.studentId,
        studentCode: student.studentCode || student.studentId,
        name: student.name,
      },
      parents: parentLinks.map((link) => ({
        id: link.id,
        parentId: link.parentId,
        name: link.parent.email?.split('@')[0] || 'Parent',
        mobile: link.parent.mobileNumber || link.parent.phone || '—',
        email: link.parent.email || '—',
        relationship: link.relationshipType,
        status: link.status,
        linkedAt: link.linkedAt,
        revokedAt: link.revokedAt,
      })),
    };
  }

  /**
   * Add / Link a parent to a student (creates or reuses Parent User)
   */
  async addParentToStudent(
    studentId: string,
    dto: AddStudentParentDto,
    actorUserId: string,
  ) {
    const student = await this.prisma.student.findFirst({
      where: {
        OR: [{ id: studentId }, { studentId: studentId }],
      },
      select: {
        id: true,
        studentId: true,
        name: true,
      },
    });

    if (!student) {
      throw new NotFoundException(`Student with ID '${studentId}' was not found.`);
    }

    const cleanMobile = dto.mobile.replace(/\D/g, '').slice(-10);
    const cleanEmail = dto.email.trim().toLowerCase();

    if (cleanMobile.length < 10) {
      throw new BadRequestException('Mobile number must contain at least 10 digits.');
    }

    // 1. Check if Parent role exists
    let parentRole = await this.prisma.role.findUnique({
      where: { name: 'PARENT' },
    });

    if (!parentRole) {
      parentRole = await this.prisma.role.create({
        data: {
          name: 'PARENT',
          description: 'Parent guardian role for student academic monitoring',
          isActive: true,
        },
      });
    }

    // 2. Check if a User already exists with this mobile or email
    let parentUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          { mobileNumber: cleanMobile },
          { phone: cleanMobile },
          { email: cleanEmail },
        ],
      },
      include: {
        userRoles: { include: { role: true } },
      },
    });

    if (parentUser) {
      // Check if user is a student without parent capability
      const hasParentRole = parentUser.userRoles.some(
        (ur) => ur.role.name === 'PARENT',
      );
      if (!hasParentRole) {
        // Assign PARENT role
        await this.prisma.userRole.create({
          data: {
            userId: parentUser.id,
            roleId: parentRole.id,
          },
        });
      }
    } else {
      // Create new Parent User
      parentUser = await this.prisma.user.create({
        data: {
          mobileNumber: cleanMobile,
          phone: cleanMobile,
          email: cleanEmail,
          status: 'ACTIVE',
          isActive: true,
          isVerified: true,
          mobileVerifiedAt: new Date(),
          userRoles: {
            create: {
              roleId: parentRole.id,
            },
          },
        },
        include: {
          userRoles: { include: { role: true } },
        },
      });
    }

    // 3. Check / Upsert ParentStudentLink
    const existingLink = await this.prisma.parentStudentLink.findUnique({
      where: {
        parentId_studentId: {
          parentId: parentUser.id,
          studentId: student.id,
        },
      },
    });

    let linkResult;
    if (existingLink) {
      if (existingLink.status === ParentLinkStatus.ACTIVE) {
        throw new BadRequestException(
          'This parent is already actively linked to this student.',
        );
      }
      linkResult = await this.prisma.parentStudentLink.update({
        where: { id: existingLink.id },
        data: {
          status: ParentLinkStatus.ACTIVE,
          relationshipType: dto.relationship as ParentRelationshipType,
          linkedAt: new Date(),
          revokedAt: null,
        },
      });
    } else {
      linkResult = await this.prisma.parentStudentLink.create({
        data: {
          parentId: parentUser.id,
          studentId: student.id,
          relationshipType: dto.relationship as ParentRelationshipType,
          status: ParentLinkStatus.ACTIVE,
          linkedAt: new Date(),
        },
      });
    }

    // 4. Audit Log
    try {
      await this.prisma.auditLog.create({
        data: {
          actorUserId,
          action: 'PARENT_LINK_CREATED',
          entityType: 'PARENT_STUDENT_LINK',
          entityId: linkResult.id,
          afterState: {
            parentId: parentUser.id,
            studentId: student.id,
            relationship: dto.relationship,
            parentName: dto.name,
            parentMobile: cleanMobile,
            parentEmail: cleanEmail,
          },
          reason: `Admin linked parent ${dto.name} (${dto.relationship}) to student ${student.name} (${student.studentId})`,
        },
      });
    } catch (e) {
      this.logger.warn(`Failed to write audit log for parent link creation: ${e}`);
    }

    return {
      message: 'Parent linked successfully.',
      data: {
        id: linkResult.id,
        parentId: parentUser.id,
        name: dto.name,
        mobile: cleanMobile,
        email: cleanEmail,
        relationship: linkResult.relationshipType,
        status: linkResult.status,
        linkedAt: linkResult.linkedAt,
      },
    };
  }

  /**
   * Revoke/Unlink parent relationship
   */
  async revokeParentLink(
    studentId: string,
    linkId: string,
    actorUserId: string,
  ) {
    const student = await this.prisma.student.findFirst({
      where: {
        OR: [{ id: studentId }, { studentId: studentId }],
      },
    });

    if (!student) {
      throw new NotFoundException(`Student with ID '${studentId}' was not found.`);
    }

    const link = await this.prisma.parentStudentLink.findFirst({
      where: {
        id: linkId,
        studentId: student.id,
      },
      include: { parent: true },
    });

    if (!link) {
      throw new NotFoundException('Parent relationship link not found for this student.');
    }

    const updated = await this.prisma.parentStudentLink.update({
      where: { id: link.id },
      data: {
        status: ParentLinkStatus.REVOKED,
        revokedAt: new Date(),
      },
    });

    // Audit Log
    try {
      await this.prisma.auditLog.create({
        data: {
          actorUserId,
          action: 'PARENT_LINK_REVOKED',
          entityType: 'PARENT_STUDENT_LINK',
          entityId: link.id,
          beforeState: { status: link.status },
          afterState: { status: updated.status, revokedAt: updated.revokedAt },
          reason: `Admin revoked parent link between parent ${link.parentId} and student ${student.name} (${student.studentId})`,
        },
      });
    } catch (e) {
      this.logger.warn(`Failed to write audit log for parent link revocation: ${e}`);
    }

    return {
      message: 'Parent link revoked successfully.',
    };
  }
}
