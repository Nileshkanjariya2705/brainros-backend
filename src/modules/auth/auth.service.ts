import { Injectable, BadRequestException, NotFoundException, UnauthorizedException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from './services/otp.service';
import { TokenService } from './services/token.service';
import { PasswordService } from './services/password.service';
import { RegisterStudentDto } from './dto/register-student.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otpService: OtpService,
    private readonly tokenService: TokenService,
    private readonly passwordService: PasswordService,
  ) {}

  /**
   * Send SMS OTP to the given mobile number (includes rate limits & resend cooldown check)
   */
  async sendOtp(mobileNumber: string): Promise<{ success: boolean; message: string }> {
    await this.otpService.sendOtp(mobileNumber);
    return {
      success: true,
      message: 'OTP sent successfully',
    };
  }

  /**
   * Verify SMS OTP and login/register the user automatically
   */
  async verifyOtp(mobileNumber: string, otp: string) {
    // 1. Verify OTP with 2Factor and check attempts in Redis
    await this.otpService.verifyOtp(mobileNumber, otp);

    const normalizedMobile = this.otpService.normalizeMobileNumber(mobileNumber);

    // 2. Check if user exists by mobileNumber OR phone (for backward compatibility)
    let user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { mobileNumber: normalizedMobile },
          { phone: normalizedMobile },
        ],
      },
      include: {
        userRoles: {
          include: {
            role: true,
          },
        },
      },
    });

    let message = 'Login successful';
    let statusCode = 200;

    if (!user) {
      // 3. User does not exist -> Automatically register user
      statusCode = 201;
      message = 'Registration successful';

      user = await this.prisma.$transaction(async (tx) => {
        // a. Create the User mapping both phone and mobileNumber for safety
        const newUser = await tx.user.create({
          data: {
            phone: normalizedMobile,
            mobileNumber: normalizedMobile,
            isVerified: true,
            isActive: true,
          },
        });

        // b. Fetch STUDENT role
        let studentRole = await tx.role.findUnique({
          where: { name: 'STUDENT' },
        });

        if (!studentRole) {
          // Fallback if roles seed wasn't run
          studentRole = await tx.role.create({
            data: { name: 'STUDENT' },
          });
        }

        // c. Link STUDENT role to User
        await tx.userRole.create({
          data: {
            userId: newUser.id,
            roleId: studentRole.id,
          },
        });

        return tx.user.findUnique({
          where: { id: newUser.id },
          include: {
            userRoles: {
              include: {
                role: true,
              },
            },
          },
        }) as any;
      });
    }

    if (!user) {
      throw new InternalServerErrorException('Failed to retrieve or create user.');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('User account is inactive.');
    }

    // 4. Generate Access and Refresh Tokens
    const roles = user.userRoles.map((ur) => ur.role.name);
    const tokens = await this.tokenService.generateTokens(user.id, roles);

    return {
      success: true,
      message,
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user: {
          id: user.id,
          phone: user.phone,
          mobileNumber: user.mobileNumber,
          email: user.email,
          isActive: user.isActive,
          isVerified: user.isVerified,
          roles,
        },
      },
    };
  }

  /**
   * Register a new student profile in a transaction (compatible with standard credentials flow)
   */
  async registerStudent(dto: RegisterStudentDto) {
    const {
      phone,
      name,
      email,
      state,
      district,
      schoolCollege,
      classId,
      preferredLanguageId,
      examTargetId,
    } = dto;

    const normalizedMobile = this.otpService.normalizeMobileNumber(phone);

    // 1. Double check user doesn't exist yet
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          { mobileNumber: normalizedMobile },
          { phone: normalizedMobile },
        ],
      },
    });

    if (existingUser) {
      throw new BadRequestException('A user with this mobile number already exists.');
    }

    if (email) {
      const existingEmail = await this.prisma.user.findUnique({ where: { email } });
      if (existingEmail) {
        throw new BadRequestException('A user with this email already exists.');
      }
    }

    // 2. Verify relations exist before entering transaction
    const [targetClass, targetLang, targetExam] = await Promise.all([
      this.prisma.studentClass.findUnique({ where: { id: classId } }),
      this.prisma.preferredLanguage.findUnique({ where: { id: preferredLanguageId } }),
      this.prisma.examTarget.findUnique({ where: { id: examTargetId } }),
    ]);

    if (!targetClass) throw new NotFoundException('Selected class does not exist.');
    if (!targetLang) throw new NotFoundException('Selected preferred language does not exist.');
    if (!targetExam) throw new NotFoundException('Selected exam target does not exist.');

    // 3. Run database transaction to guarantee atomicity (User + Role + Student Profile)
    const result = await this.prisma.$transaction(async (tx) => {
      // a. Create User populating both phone and mobileNumber for compatibility
      const user = await tx.user.create({
        data: {
          phone: normalizedMobile,
          mobileNumber: normalizedMobile,
          email: email || null,
          isVerified: true,
          isActive: true,
        },
      });

      // b. Find Role
      const studentRole = await tx.role.findUnique({
        where: { name: 'STUDENT' },
      });
      if (!studentRole) {
        throw new BadRequestException('STUDENT role not found in system. Please seed roles first.');
      }

      // c. Map STUDENT role to User
      await tx.userRole.create({
        data: {
          userId: user.id,
          roleId: studentRole.id,
        },
      });

      // d. Generate Unique business studentId (e.g. STU001001)
      const count = await tx.student.count();
      const studentId = `STU${String(count + 1001).padStart(6, '0')}`;

      // e. Create Student profile record
      const student = await tx.student.create({
        data: {
          userId: user.id,
          studentId,
          name,
          state,
          district,
          schoolCollege,
          classId,
          preferredLanguageId,
          examTargetId,
        },
      });

      return { user, student };
    });

    // 4. Issue session tokens
    const tokens = await this.tokenService.generateTokens(result.user.id, ['STUDENT']);

    return {
      user: {
        id: result.user.id,
        phone: result.user.phone,
        mobileNumber: result.user.mobileNumber,
        email: result.user.email,
        isActive: result.user.isActive,
        isVerified: result.user.isVerified,
        roles: ['STUDENT'],
      },
      student: {
        id: result.student.id,
        studentId: result.student.studentId,
        name: result.student.name,
        state: result.student.state,
        district: result.student.district,
        schoolCollege: result.student.schoolCollege,
      },
      ...tokens,
    };
  }

  /**
   * Rotate access tokens using refresh token
   */
  async refreshSession(refreshToken: string) {
    return this.tokenService.refreshAccessTokens(refreshToken);
  }

  /**
   * Terminate user session
   */
  async logout(refreshToken: string): Promise<{ message: string }> {
    await this.tokenService.revokeRefreshToken(refreshToken);
    return { message: 'Logged out successfully.' };
  }

  /**
   * Get user profile details
   */
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: {
          include: {
            role: true,
          },
        },
        student: {
          include: {
            studentClass: true,
            preferredLanguage: true,
            examTarget: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const roles = user.userRoles.map((ur) => ur.role.name);

    return {
      id: user.id,
      phone: user.phone,
      mobileNumber: user.mobileNumber,
      email: user.email,
      isActive: user.isActive,
      isVerified: user.isVerified,
      roles,
      studentProfile: user.student
        ? {
            id: user.student.id,
            studentId: user.student.studentId,
            name: user.student.name,
            state: user.student.state,
            district: user.student.district,
            schoolCollege: user.student.schoolCollege,
            class: user.student.studentClass.name,
            examTarget: user.student.examTarget.name,
            preferredLanguage: user.student.preferredLanguage.name,
          }
        : null,
    };
  }

  /**
   * Fetch list of Classes, Languages, and Exam Targets for frontend registration
   */
  async getRegisterOptions() {
    const [classes, languages, examTargets] = await Promise.all([
      this.prisma.studentClass.findMany({ select: { id: true, name: true } }),
      this.prisma.preferredLanguage.findMany({ select: { id: true, name: true } }),
      this.prisma.examTarget.findMany({ select: { id: true, name: true } }),
    ]);

    return {
      classes,
      languages,
      examTargets,
    };
  }
}
