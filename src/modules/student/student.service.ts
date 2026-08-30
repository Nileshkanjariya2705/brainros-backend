import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SecurityEventService } from '../auth/services/security-event.service';
import { OtpService } from '../auth/services/otp.service';
import { RedisService } from '../redis/redis.service';
import { UpdateStudentProfileDto } from './dto/update-student-profile.dto';
import {
  RequestChangeMobileDto,
  VerifyChangeMobileDto,
} from './dto/change-mobile.dto';
import {
  RequestChangeEmailDto,
  VerifyChangeEmailDto,
} from './dto/change-email.dto';

@Injectable()
export class StudentService {
  private readonly logger = new Logger(StudentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly securityEventService: SecurityEventService,
    private readonly otpService: OtpService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Get student profile by authenticated user ID.
   * Auto-provisions a student record if the authenticated user does not have one yet.
   */
  async getProfile(userId: string) {
    let student = await this.prisma.student.findUnique({
      where: { userId },
      include: {
        studentClass: true,
        examTarget: true,
        preferredLanguage: true,
        stateRef: true,
        districtRef: true,
        user: {
          select: {
            id: true,
            email: true,
            mobileNumber: true,
            phone: true,
            status: true,
            isVerified: true,
            isActive: true,
            lastLoginAt: true,
            createdAt: true,
          },
        },
      },
    });

    if (!student) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new NotFoundException('User account not found.');
      }

      // Auto-provision a default Student profile with unique Student ID
      const year = new Date().getFullYear();
      let sequenceNum = (await this.prisma.student.count()) + 1;
      let studentIdStr = `STU${String(sequenceNum + 1000).padStart(6, '0')}`;
      let studentCode = `BRN-${year}-${String(sequenceNum).padStart(6, '0')}`;

      let collision = await this.prisma.student.findFirst({
        where: { OR: [{ studentCode }, { studentId: studentIdStr }] },
      });
      while (collision) {
        sequenceNum++;
        studentIdStr = `STU${String(sequenceNum + 1000).padStart(6, '0')}`;
        studentCode = `BRN-${year}-${String(sequenceNum).padStart(6, '0')}`;
        collision = await this.prisma.student.findFirst({
          where: { OR: [{ studentCode }, { studentId: studentIdStr }] },
        });
      }

      let [firstClass, firstLang, firstTarget, firstState] = await Promise.all([
        this.prisma.studentClass.findFirst(),
        this.prisma.preferredLanguage.findFirst({ where: { isActive: true } }),
        this.prisma.examTarget.findFirst(),
        this.prisma.state.findFirst({
          where: { isActive: true },
          include: { districts: true },
        }),
      ]);

      if (!firstClass) {
        firstClass = await this.prisma.studentClass.create({
          data: { name: 'Class 12', description: 'Standard 12' },
        });
      }
      if (!firstLang) {
        firstLang = await this.prisma.preferredLanguage.create({
          data: {
            name: 'English',
            code: 'en',
            nativeName: 'English',
            isActive: true,
          },
        });
      }
      if (!firstTarget) {
        firstTarget = await this.prisma.examTarget.create({
          data: { name: 'JEE Main', description: 'Engineering Entrance' },
        });
      }
      if (!firstState) {
        firstState = await this.prisma.state.create({
          data: {
            name: 'Karnataka',
            code: 'KA',
            isActive: true,
            districts: {
              create: [{ name: 'Bengaluru', isActive: true }],
            },
          },
          include: { districts: true },
        });
      }

      student = await this.prisma.student.create({
        data: {
          userId: user.id,
          studentId: studentIdStr,
          studentCode,
          name:
            user.email?.split('@')[0] ||
            user.mobileNumber ||
            user.phone ||
            'Student',
          state: firstState?.name || 'Karnataka',
          district: firstState?.districts?.[0]?.name || 'Bengaluru',
          stateId: firstState?.id || null,
          districtId: firstState?.districts?.[0]?.id || null,
          schoolCollege: 'Educational Institute',
          classId: firstClass.id,
          preferredLanguageId: firstLang.id,
          examTargetId: firstTarget.id,
          status: 'ACTIVE',
        },
        include: {
          studentClass: true,
          examTarget: true,
          preferredLanguage: true,
          stateRef: true,
          districtRef: true,
          user: {
            select: {
              id: true,
              email: true,
              mobileNumber: true,
              phone: true,
              status: true,
              isVerified: true,
              isActive: true,
              lastLoginAt: true,
              createdAt: true,
            },
          },
        },
      });
    }

    return student;
  }

  /**
   * Update student profile permitted fields with strict validation of master data
   */
  async updateProfile(
    userId: string,
    dto: UpdateStudentProfileDto,
    requestContext?: any,
  ) {
    let currentStudent = await this.prisma.student.findUnique({
      where: { userId },
    });

    if (!currentStudent) {
      currentStudent = await this.getProfile(userId);
    }

    // Validate relationships if provided
    if (dto.classId) {
      const cls = await this.prisma.studentClass.findUnique({
        where: { id: dto.classId },
      });
      if (!cls) throw new NotFoundException('Selected class not found.');
    }

    if (dto.examTargetId) {
      const target = await this.prisma.examTarget.findUnique({
        where: { id: dto.examTargetId },
      });
      if (!target)
        throw new NotFoundException('Selected exam target not found.');
    }

    if (dto.preferredLanguageId) {
      const lang = await this.prisma.preferredLanguage.findUnique({
        where: { id: dto.preferredLanguageId },
      });
      if (!lang)
        throw new NotFoundException('Selected preferred language not found.');
      if (!lang.isActive)
        throw new BadRequestException('Selected language is not active.');
    }

    let stateName = currentStudent.state;
    let districtName = currentStudent.district;

    if (dto.stateId) {
      const state = await this.prisma.state.findUnique({
        where: { id: dto.stateId },
      });
      if (!state) throw new NotFoundException('Selected state not found.');
      if (!state.isActive)
        throw new BadRequestException('Selected state is not active.');
      stateName = state.name;
    }

    if (dto.districtId) {
      const district = await this.prisma.district.findUnique({
        where: { id: dto.districtId },
      });
      if (!district)
        throw new NotFoundException('Selected district not found.');

      const effectiveStateId = dto.stateId || currentStudent.stateId;
      if (effectiveStateId && district.stateId !== effectiveStateId) {
        throw new BadRequestException(
          'Selected district does not belong to the selected state.',
        );
      }
      districtName = district.name;
    }

    // Update profile
    const updatedStudent = await this.prisma.student.update({
      where: { userId },
      data: {
        name: dto.name !== undefined ? dto.name.trim() : undefined,
        schoolCollege:
          dto.schoolCollege !== undefined
            ? dto.schoolCollege.trim()
            : undefined,
        classId: dto.classId,
        examTargetId: dto.examTargetId,
        preferredLanguageId: dto.preferredLanguageId,
        stateId: dto.stateId,
        districtId: dto.districtId,
        state: stateName,
        district: districtName,
      },
      include: {
        studentClass: true,
        examTarget: true,
        preferredLanguage: true,
        stateRef: true,
        districtRef: true,
        user: {
          select: {
            id: true,
            email: true,
            mobileNumber: true,
            phone: true,
            status: true,
            isVerified: true,
            isActive: true,
            lastLoginAt: true,
            createdAt: true,
          },
        },
      },
    });

    await this.securityEventService.log('ROLE_CHANGED', {
      userId,
      ipAddress: requestContext?.ipAddress,
      userAgent: requestContext?.userAgent,
      metadata: { action: 'PROFILE_UPDATED' },
    });

    return updatedStudent;
  }

  // ═══════════════════════════════════════════════════════════════
  // SENSITIVE CONTACT UPDATES (OTP VERIFIED)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Request mobile change: validates uniqueness and sends OTP to the NEW mobile number
   */
  async requestChangeMobile(
    userId: string,
    dto: RequestChangeMobileDto,
    requestContext?: any,
  ) {
    const normalizedNewMobile = this.otpService.normalizeMobileNumber(
      dto.newMobileNumber,
    );

    // Check if new mobile is already in use by another user
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [
          { mobileNumber: normalizedNewMobile },
          { phone: normalizedNewMobile },
        ],
        NOT: { id: userId },
      },
    });

    if (existing) {
      throw new BadRequestException(
        'This mobile number is already in use by another account.',
      );
    }

    // Save pending change in Redis (5 min TTL)
    await this.redisService.set(
      `mobile-change:${userId}`,
      JSON.stringify({
        newMobile: normalizedNewMobile,
        createdAt: new Date().toISOString(),
      }),
      300,
    );

    // Send OTP to the NEW mobile
    await this.otpService.sendOtp(normalizedNewMobile, 'CHANGE_MOBILE', {
      ...requestContext,
      userId,
    });

    return {
      message: 'OTP sent to new mobile number for verification.',
      data: { requiresOtp: true, purpose: 'CHANGE_MOBILE', expiresIn: 300 },
    };
  }

  /**
   * Verify mobile change OTP: verifies OTP on new mobile and updates User record
   */
  async verifyChangeMobile(
    userId: string,
    dto: VerifyChangeMobileDto,
    requestContext?: any,
  ) {
    const rawData = await this.redisService.get(`mobile-change:${userId}`);
    if (!rawData) {
      throw new BadRequestException(
        'Mobile change request expired or not found. Please request again.',
      );
    }

    const { newMobile } = JSON.parse(rawData);

    // Verify OTP
    await this.otpService.verifyOtp(newMobile, dto.otp, 'CHANGE_MOBILE', {
      ...requestContext,
      userId,
    });

    // Invalidate pending change in Redis
    await this.redisService.del(`mobile-change:${userId}`);

    // Update User mobile
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        mobileNumber: newMobile,
        phone: newMobile,
        mobileVerifiedAt: new Date(),
      },
    });

    await this.securityEventService.log('MOBILE_CHANGED', {
      userId,
      ipAddress: requestContext?.ipAddress,
      userAgent: requestContext?.userAgent,
      metadata: { newMobile },
    });

    return {
      message: 'Mobile number updated successfully.',
      data: {
        userId: updatedUser.id,
        mobileNumber: updatedUser.mobileNumber,
        mobileVerifiedAt: updatedUser.mobileVerifiedAt,
      },
    };
  }

  /**
   * Request email change: validates uniqueness and sends OTP
   */
  async requestChangeEmail(
    userId: string,
    dto: RequestChangeEmailDto,
    requestContext?: any,
  ) {
    const normalizedEmail = dto.newEmail.toLowerCase().trim();

    const existing = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existing && existing.id !== userId) {
      throw new BadRequestException(
        'This email is already in use by another account.',
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || (!user.mobileNumber && !user.phone)) {
      throw new BadRequestException(
        'User does not have a verified mobile for authorization.',
      );
    }

    const targetMobile = user.mobileNumber || user.phone!;

    // Save pending change in Redis (5 min TTL)
    await this.redisService.set(
      `email-change:${userId}`,
      JSON.stringify({
        newEmail: normalizedEmail,
        createdAt: new Date().toISOString(),
      }),
      300,
    );

    // Send verification OTP to account mobile
    await this.otpService.sendOtp(targetMobile, 'VERIFY_EMAIL', {
      ...requestContext,
      userId,
    });

    return {
      message:
        'Security OTP sent to your registered mobile to authorize email change.',
      data: { requiresOtp: true, purpose: 'VERIFY_EMAIL', expiresIn: 300 },
    };
  }

  /**
   * Verify email change OTP: updates User email
   */
  async verifyChangeEmail(
    userId: string,
    dto: VerifyChangeEmailDto,
    requestContext?: any,
  ) {
    const rawData = await this.redisService.get(`email-change:${userId}`);
    if (!rawData) {
      throw new BadRequestException(
        'Email change request expired or not found. Please request again.',
      );
    }

    const { newEmail } = JSON.parse(rawData);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || (!user.mobileNumber && !user.phone)) {
      throw new BadRequestException('User not found.');
    }

    const targetMobile = user.mobileNumber || user.phone!;

    // Verify OTP
    await this.otpService.verifyOtp(targetMobile, dto.otp, 'VERIFY_EMAIL', {
      ...requestContext,
      userId,
    });

    await this.redisService.del(`email-change:${userId}`);

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        email: newEmail,
        emailVerifiedAt: new Date(),
      },
    });

    await this.securityEventService.log('EMAIL_CHANGED', {
      userId,
      ipAddress: requestContext?.ipAddress,
      userAgent: requestContext?.userAgent,
      metadata: { newEmail },
    });

    return {
      message: 'Email updated successfully.',
      data: {
        userId: updatedUser.id,
        email: updatedUser.email,
        emailVerifiedAt: updatedUser.emailVerifiedAt,
      },
    };
  }

  /**
   * Get student's login sessions
   */
  async getSessions(userId: string) {
    return this.prisma.loginSession.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        deviceId: true,
        userAgent: true,
        ipAddress: true,
        lastActivityAt: true,
        createdAt: true,
      },
      orderBy: { lastActivityAt: 'desc' },
    });
  }
}
