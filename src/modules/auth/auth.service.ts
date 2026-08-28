import {
  Injectable,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService, OtpPurpose } from './services/otp.service';
import { TokenService } from './services/token.service';
import { PasswordService } from './services/password.service';
import { SessionService } from './services/session.service';
import { OAuthService } from './services/oauth.service';
import { SecurityEventService } from './services/security-event.service';
import { RegisterStudentDto } from './dto/register-student.dto';
import { VerifyRegistrationOtpDto } from './dto/verify-registration-otp.dto';
import {
  RequestPasswordlessLoginOtpDto,
  VerifyPasswordlessLoginOtpDto,
} from './dto/passwordless-login.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { RedisService } from '../redis/redis.service';
import * as crypto from 'crypto';

export interface PendingRegistrationData {
  registrationId: string;
  mobile: string;
  email: string | null;
  name: string;
  state: string;
  district: string;
  stateId: string | null;
  districtId: string | null;
  schoolCollege: string;
  classId: string;
  preferredLanguageId: string;
  examTargetId: string;
  status: 'PENDING_OTP' | 'VERIFIED' | 'COMPLETED';
  createdAt: string;
}

export interface PendingLoginData {
  loginRequestId: string;
  userId: string;
  mobile: string;
  identifier: string;
  status: 'PENDING_OTP' | 'VERIFIED' | 'CONSUMED';
  createdAt: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly otpService: OtpService,
    private readonly tokenService: TokenService,
    private readonly passwordService: PasswordService,
    private readonly sessionService: SessionService,
    private readonly oauthService: OAuthService,
    private readonly securityEventService: SecurityEventService,
    private readonly redisService: RedisService,
  ) {}

  // ─── Helper: Extract request metadata ─────────────────────────
  private extractRequestContext(req: any) {
    return {
      ipAddress: req?.ip || req?.connection?.remoteAddress || undefined,
      userAgent: req?.headers?.['user-agent'] || undefined,
    };
  }

  // ─── Helper: Mask mobile number for public responses ──────────
  maskMobile(mobile: string): string {
    if (!mobile || mobile.length < 4) return '******';
    const last4 = mobile.slice(-4);
    return '******' + last4;
  }

  // ─── Helper: Build user response ──────────────────────────────
  private buildUserResponse(user: any) {
    const roles = (user.userRoles || []).map((ur: any) => ur.role?.name || ur.role || ur);
    return {
      userId: user.id,
      email: user.email,
      mobileNumber: user.mobileNumber || user.phone,
      status: user.status,
      isVerified: user.isVerified,
      roles,
    };
  }

  // ─── Helper: Build full auth response ─────────────────────────
  private buildAuthResponse(
    user: any,
    sessionId: string,
    tokens: { accessToken: string; refreshToken: string; expiresIn: number },
    message: string,
  ) {
    return {
      message,
      data: {
        user: this.buildUserResponse(user),
        student: user.student
          ? {
              id: user.student.id,
              studentId: user.student.studentId,
              studentCode: user.student.studentCode,
              name: user.student.name,
            }
          : null,
        session: { sessionId },
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      },
    };
  }

  // ─── Helper: Create session and tokens ────────────────────────
  private async createSessionAndTokens(userId: string, req: any) {
    const ctx = this.extractRequestContext(req);
    const session = await this.sessionService.createSession({
      userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    const tokens = await this.tokenService.generateTokens(userId, session.id);
    return { session, tokens };
  }

  // ─── Helper: Load user with roles ─────────────────────────────
  private async loadUserWithRoles(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: { include: { role: true } },
        student: {
          include: {
            studentClass: true,
            preferredLanguage: true,
            examTarget: true,
            stateRef: true,
            districtRef: true,
          },
        },
      },
    });
  }

  // ─── Helper: Verify account status ────────────────────────────
  private verifyAccountActive(user: any): void {
    if (!user.isActive) {
      throw new UnauthorizedException('User account is inactive.');
    }
    if (user.status === 'SUSPENDED') {
      throw new UnauthorizedException('User account is suspended.');
    }
    if (user.status === 'LOCKED') {
      throw new UnauthorizedException('User account is locked.');
    }
    if (user.status === 'DISABLED') {
      throw new UnauthorizedException('User account is disabled.');
    }
    if (user.status === 'DELETED') {
      throw new UnauthorizedException('User account has been deleted.');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 1. NEW OTP-BASED REGISTRATION FLOW (PASSWORDLESS)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Submit registration data: validates input and master records,
   * stores temporary state in Redis, sends OTP, and returns requiresOtp.
   * Does NOT activate User or create Student ID before OTP verification.
   */
  async registerStudent(dto: RegisterStudentDto, req?: any) {
    const ctx = this.extractRequestContext(req);
    const {
      phone,
      name,
      email,
      state,
      district,
      stateId,
      districtId,
      schoolCollege,
      classId,
      preferredLanguageId,
      examTargetId,
    } = dto;

    const normalizedMobile = this.otpService.normalizeMobileNumber(phone);

    // 1. Check if mobile already exists
    const existingUserByMobile = await this.prisma.user.findFirst({
      where: {
        OR: [
          { mobileNumber: normalizedMobile },
          { phone: normalizedMobile },
        ],
      },
    });

    if (existingUserByMobile) {
      throw new BadRequestException('A user with this mobile number already exists.');
    }

    // 2. Check if email already exists
    if (email) {
      const normalizedEmail = email.toLowerCase().trim();
      const existingUserByEmail = await this.prisma.user.findUnique({
        where: { email: normalizedEmail },
      });
      if (existingUserByEmail) {
        throw new BadRequestException('A user with this email already exists.');
      }
    }

    // 3. Validate master data references
    const [targetClass, targetLang, targetExam] = await Promise.all([
      this.prisma.studentClass.findUnique({ where: { id: classId } }),
      this.prisma.preferredLanguage.findUnique({ where: { id: preferredLanguageId } }),
      this.prisma.examTarget.findUnique({ where: { id: examTargetId } }),
    ]);

    if (!targetClass) throw new NotFoundException('Selected class does not exist.');
    if (!targetLang) throw new NotFoundException('Selected preferred language does not exist.');
    if (!targetExam) throw new NotFoundException('Selected exam target does not exist.');

    let resolvedStateName = state || '';
    let resolvedDistrictName = district || '';

    // Validate state & district
    if (stateId) {
      const stateRecord = await this.prisma.state.findUnique({ where: { id: stateId } });
      if (!stateRecord) throw new NotFoundException('Selected state does not exist.');
      if (!stateRecord.isActive) throw new BadRequestException('Selected state is not active.');
      resolvedStateName = stateRecord.name;
    }

    if (districtId) {
      const districtRecord = await this.prisma.district.findUnique({ where: { id: districtId } });
      if (!districtRecord) throw new NotFoundException('Selected district does not exist.');
      if (stateId && districtRecord.stateId !== stateId) {
        throw new BadRequestException('Selected district does not belong to the selected state.');
      }
      resolvedDistrictName = districtRecord.name;
    }

    // 4. Create temporary registration state in Redis
    const registrationId = `REG-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const pendingData: PendingRegistrationData = {
      registrationId,
      mobile: normalizedMobile,
      email: email ? email.toLowerCase().trim() : null,
      name: name.trim(),
      state: resolvedStateName,
      district: resolvedDistrictName,
      stateId: stateId || null,
      districtId: districtId || null,
      schoolCollege: schoolCollege.trim(),
      classId,
      preferredLanguageId,
      examTargetId,
      status: 'PENDING_OTP',
      createdAt: new Date().toISOString(),
    };

    // Store in Redis with 15 minutes (900s) TTL
    await this.redisService.set(
      `registration:${registrationId}`,
      JSON.stringify(pendingData),
      900,
    );

    // 5. Generate and send OTP via SMS provider
    await this.otpService.sendOtp(normalizedMobile, 'REGISTER', ctx);

    await this.securityEventService.log('OTP_REQUESTED', {
      ...ctx,
      metadata: { registrationId, purpose: 'REGISTER', mobile: normalizedMobile },
    });

    return {
      message: 'Registration initiated. OTP sent to your registered mobile number.',
      data: {
        requiresOtp: true,
        purpose: 'REGISTER',
        registrationId,
        mobileMasked: this.maskMobile(normalizedMobile),
        expiresIn: 300,
        resendAvailableIn: 60,
      },
    };
  }

  /**
   * Verify registration OTP: validates OTP, creates User, assigns STUDENT role,
   * creates Student with unique Student ID in one transaction, creates session and returns tokens.
   */
  async verifyRegistrationOtp(dto: VerifyRegistrationOtpDto, req?: any) {
    const ctx = this.extractRequestContext(req);
    const { registrationId, otp } = dto;

    // 1. Load pending registration from Redis
    const rawData = await this.redisService.get(`registration:${registrationId}`);
    if (!rawData) {
      throw new BadRequestException('Registration session expired or invalid. Please register again.');
    }

    const registration: PendingRegistrationData = JSON.parse(rawData);
    if (registration.status !== 'PENDING_OTP') {
      throw new BadRequestException('Registration has already been processed or is invalid.');
    }

    // 2. Verify OTP for purpose REGISTER
    await this.otpService.verifyOtp(registration.mobile, otp, 'REGISTER', ctx);

    // 3. Mark registration as completed in Redis immediately (prevents duplicate execution)
    await this.redisService.del(`registration:${registrationId}`);

    // 4. Run database transaction: User + Role + Student + Student ID
    const result = await this.prisma.$transaction(async (tx) => {
      // Final duplicate check inside transaction
      const existingUser = await tx.user.findFirst({
        where: {
          OR: [
            { mobileNumber: registration.mobile },
            { phone: registration.mobile },
            ...(registration.email ? [{ email: registration.email }] : []),
          ],
        },
      });

      if (existingUser) {
        throw new BadRequestException('A user with this mobile number or email already exists.');
      }

      // Create User
      const newUser = await tx.user.create({
        data: {
          phone: registration.mobile,
          mobileNumber: registration.mobile,
          email: registration.email,
          status: 'ACTIVE',
          isVerified: true,
          isActive: true,
          mobileVerifiedAt: new Date(),
          emailVerifiedAt: registration.email ? new Date() : null,
          lastLoginAt: new Date(),
        },
      });

      // Ensure STUDENT role exists & assign
      let studentRole = await tx.role.findUnique({ where: { name: 'STUDENT' } });
      if (!studentRole) {
        studentRole = await tx.role.create({ data: { name: 'STUDENT' } });
      }

      await tx.userRole.create({
        data: { userId: newUser.id, roleId: studentRole.id },
      });

      // Generate unique Student ID (BRN-YYYY-XXXXXX / STUXXXXXX)
      const year = new Date().getFullYear();
      let sequenceNum = (await tx.student.count()) + 1;
      let studentIdStr = `STU${String(sequenceNum + 1000).padStart(6, '0')}`;
      let studentCode = `BRN-${year}-${String(sequenceNum).padStart(6, '0')}`;

      // Check collision if pre-seeded data exists and increment sequence
      let collision = await tx.student.findFirst({
        where: { OR: [{ studentCode }, { studentId: studentIdStr }] },
      });
      while (collision) {
        sequenceNum++;
        studentIdStr = `STU${String(sequenceNum + 1000).padStart(6, '0')}`;
        studentCode = `BRN-${year}-${String(sequenceNum).padStart(6, '0')}`;
        collision = await tx.student.findFirst({
          where: { OR: [{ studentCode }, { studentId: studentIdStr }] },
        });
      }

      // Create Student profile
      const student = await tx.student.create({
        data: {
          userId: newUser.id,
          studentId: studentIdStr,
          studentCode,
          name: registration.name,
          state: registration.state,
          district: registration.district,
          stateId: registration.stateId,
          districtId: registration.districtId,
          schoolCollege: registration.schoolCollege,
          classId: registration.classId,
          preferredLanguageId: registration.preferredLanguageId,
          examTargetId: registration.examTargetId,
          status: 'ACTIVE',
        },
      });

      return { user: newUser, student };
    });

    // 5. Load full user profile
    const fullUser = await this.loadUserWithRoles(result.user.id);

    // 6. Create session and tokens
    const { session, tokens } = await this.createSessionAndTokens(result.user.id, req);

    // 7. Log security events
    await this.securityEventService.log('REGISTER_SUCCESS', {
      userId: result.user.id,
      ...ctx,
      metadata: { method: 'OTP_REGISTRATION', studentId: result.student.studentId, studentCode: result.student.studentCode },
    });

    return {
      message: 'Registration successful',
      data: {
        user: this.buildUserResponse(fullUser),
        student: {
          id: result.student.id,
          studentId: result.student.studentId,
          studentCode: result.student.studentCode,
          name: result.student.name,
        },
        session: { sessionId: session.id },
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. UNIFIED PASSWORDLESS LOGIN FLOW
  // ═══════════════════════════════════════════════════════════════

  /**
   * Request Login OTP: Accepts Email, Student ID, or Mobile number.
   * Resolves the User account, checks account status, and sends OTP to
   * the verified mobile number associated with that account.
   */
  async requestPasswordlessLoginOtp(dto: RequestPasswordlessLoginOtpDto, req?: any) {
    const ctx = this.extractRequestContext(req);
    const rawIdentifier = dto.identifier.trim();
    if (!rawIdentifier) {
      throw new BadRequestException('Login identifier is required.');
    }

    let user: any = null;

    // A. Check if identifier is an Email
    if (rawIdentifier.includes('@')) {
      const normalizedEmail = rawIdentifier.toLowerCase().trim();
      user = await this.prisma.user.findUnique({
        where: { email: normalizedEmail },
        include: { userRoles: { include: { role: true } }, student: true },
      });
    }

    // B. Check if identifier is a Student ID (e.g. BRN-2026-000001, STU001001)
    if (!user && (rawIdentifier.toUpperCase().startsWith('BRN-') || rawIdentifier.toUpperCase().startsWith('STU'))) {
      const student = await this.prisma.student.findFirst({
        where: {
          OR: [
            { studentCode: { equals: rawIdentifier, mode: 'insensitive' } },
            { studentId: { equals: rawIdentifier, mode: 'insensitive' } },
          ],
        },
        include: {
          user: {
            include: { userRoles: { include: { role: true } }, student: true },
          },
        },
      });
      if (student?.user) {
        user = student.user;
      }
    }

    // C. Check if identifier is a Mobile Number
    if (!user) {
      const normalizedMobile = this.otpService.normalizeMobileNumber(rawIdentifier);
      user = await this.prisma.user.findFirst({
        where: {
          OR: [
            { mobileNumber: normalizedMobile },
            { phone: normalizedMobile },
          ],
        },
        include: { userRoles: { include: { role: true } }, student: true },
      });
    }

    // D. Fallback search across all 3 identifiers
    if (!user) {
      const student = await this.prisma.student.findFirst({
        where: {
          OR: [
            { studentCode: { equals: rawIdentifier, mode: 'insensitive' } },
            { studentId: { equals: rawIdentifier, mode: 'insensitive' } },
          ],
        },
        include: {
          user: {
            include: { userRoles: { include: { role: true } }, student: true },
          },
        },
      });
      if (student?.user) {
        user = student.user;
      }
    }

    if (!user) {
      throw new NotFoundException('No active account found with the provided identifier.');
    }

    // Verify account status
    this.verifyAccountActive(user);

    // Ensure account has a verified mobile number
    const targetMobile = user.mobileNumber || user.phone;
    if (!targetMobile) {
      throw new BadRequestException('Account does not have a registered mobile number for OTP login.');
    }

    // Create temporary login request in Redis
    const loginRequestId = `LOGIN-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const pendingLogin: PendingLoginData = {
      loginRequestId,
      userId: user.id,
      mobile: targetMobile,
      identifier: rawIdentifier,
      status: 'PENDING_OTP',
      createdAt: new Date().toISOString(),
    };

    // 5 minutes TTL for login request
    await this.redisService.set(
      `login:${loginRequestId}`,
      JSON.stringify(pendingLogin),
      300,
    );

    // Send OTP with purpose LOGIN to the account's verified mobile
    await this.otpService.sendOtp(targetMobile, 'LOGIN', {
      ...ctx,
      userId: user.id,
    });

    await this.securityEventService.log('OTP_REQUESTED', {
      userId: user.id,
      ...ctx,
      metadata: { loginRequestId, purpose: 'LOGIN', mobile: targetMobile },
    });

    return {
      message: 'OTP sent to your registered mobile number.',
      data: {
        requiresOtp: true,
        purpose: 'LOGIN',
        loginRequestId,
        mobileMasked: this.maskMobile(targetMobile),
        expiresIn: 300,
        resendAvailableIn: 60,
      },
    };
  }

  /**
   * Verify Login OTP: Validates the OTP for LOGIN purpose,
   * creates a LoginSession, and issues access + refresh tokens.
   */
  async verifyPasswordlessLoginOtp(dto: VerifyPasswordlessLoginOtpDto, req?: any) {
    const ctx = this.extractRequestContext(req);
    const { loginRequestId, otp } = dto;

    // 1. Load login request from Redis
    const rawData = await this.redisService.get(`login:${loginRequestId}`);
    if (!rawData) {
      throw new BadRequestException('Login request has expired or is invalid. Please request a new OTP.');
    }

    const loginRequest: PendingLoginData = JSON.parse(rawData);
    if (loginRequest.status !== 'PENDING_OTP') {
      throw new BadRequestException('Login request has already been consumed or is invalid.');
    }

    // 2. Verify OTP
    await this.otpService.verifyOtp(loginRequest.mobile, otp, 'LOGIN', {
      ...ctx,
      userId: loginRequest.userId,
    });

    // 3. Invalidate login request (single-use)
    await this.redisService.del(`login:${loginRequestId}`);

    // 4. Load user and verify status
    const user = await this.loadUserWithRoles(loginRequest.userId);
    if (!user) {
      throw new NotFoundException('User account no longer exists.');
    }

    this.verifyAccountActive(user);

    // 5. Update last login timestamp
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        status: user.status === 'PENDING' ? 'ACTIVE' : user.status,
      },
    });

    // 6. Create session and tokens
    const { session, tokens } = await this.createSessionAndTokens(user.id, req);

    // 7. Log success
    await this.securityEventService.log('LOGIN_SUCCESS', {
      userId: user.id,
      ...ctx,
      metadata: { method: 'PASSWORDLESS_OTP', sessionId: session.id },
    });

    return this.buildAuthResponse(user, session.id, tokens, 'Login successful');
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. RESEND OTP (COOLDOWN PROTECTED)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Resend OTP for either a pending registration, login request, or mobile number.
   */
  async resendOtp(dto: ResendOtpDto, req?: any) {
    const ctx = this.extractRequestContext(req);

    if (dto.registrationId) {
      const rawData = await this.redisService.get(`registration:${dto.registrationId}`);
      if (!rawData) {
        throw new BadRequestException('Registration session expired or invalid. Please register again.');
      }
      const registration: PendingRegistrationData = JSON.parse(rawData);
      await this.otpService.sendOtp(registration.mobile, 'REGISTER', ctx);
      return {
        message: 'Registration OTP resent successfully.',
        data: { resendAvailableIn: 60, expiresIn: 300 },
      };
    }

    if (dto.loginRequestId) {
      const rawData = await this.redisService.get(`login:${dto.loginRequestId}`);
      if (!rawData) {
        throw new BadRequestException('Login request expired. Please request a new login OTP.');
      }
      const loginRequest: PendingLoginData = JSON.parse(rawData);
      await this.otpService.sendOtp(loginRequest.mobile, 'LOGIN', {
        ...ctx,
        userId: loginRequest.userId,
      });
      return {
        message: 'Login OTP resent successfully.',
        data: { resendAvailableIn: 60, expiresIn: 300 },
      };
    }

    if (dto.mobileNumber) {
      const mobile = this.otpService.normalizeMobileNumber(dto.mobileNumber);
      const purpose = (dto.purpose as OtpPurpose) || 'LOGIN';
      await this.otpService.sendOtp(mobile, purpose, ctx);
      return {
        message: 'OTP resent successfully.',
        data: { resendAvailableIn: 60, expiresIn: 300 },
      };
    }

    throw new BadRequestException('registrationId, loginRequestId, or mobileNumber must be provided to resend OTP.');
  }

  // ═══════════════════════════════════════════════════════════════
  // 4. LEGACY / DIRECT MOBILE OTP LOGIN & VERIFICATION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Legacy / Direct verify OTP and authenticate user
   */
  async verifyOtpAndLogin(mobileNumber: string, otp: string, purpose: OtpPurpose, req?: any) {
    const ctx = this.extractRequestContext(req);

    // 1. Verify OTP
    await this.otpService.verifyOtp(mobileNumber, otp, purpose, ctx);

    const normalizedMobile = this.otpService.normalizeMobileNumber(mobileNumber);

    // 2. Find or create user
    let user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { mobileNumber: normalizedMobile },
          { phone: normalizedMobile },
        ],
      },
      include: {
        userRoles: { include: { role: true } },
      },
    });

    let message = 'Login successful';

    if (!user) {
      // Auto-register on first OTP verification (backward compatibility)
      user = await this.prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            phone: normalizedMobile,
            mobileNumber: normalizedMobile,
            status: 'ACTIVE',
            isVerified: true,
            isActive: true,
            mobileVerifiedAt: new Date(),
            lastLoginAt: new Date(),
          },
        });

        let studentRole = await tx.role.findUnique({ where: { name: 'STUDENT' } });
        if (!studentRole) {
          studentRole = await tx.role.create({ data: { name: 'STUDENT' } });
        }

        await tx.userRole.create({
          data: { userId: newUser.id, roleId: studentRole.id },
        });

        return tx.user.findUnique({
          where: { id: newUser.id },
          include: { userRoles: { include: { role: true } } },
        }) as any;
      });

      message = 'Registration successful';

      await this.securityEventService.log('REGISTER_SUCCESS', {
        userId: user!.id,
        ...ctx,
        metadata: { method: 'MOBILE_OTP', mobile: normalizedMobile },
      });
    }

    if (!user) {
      throw new InternalServerErrorException('Failed to retrieve or create user.');
    }

    this.verifyAccountActive(user);

    // 3. Update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        mobileVerifiedAt: new Date(),
        status: user.status === 'PENDING' ? 'ACTIVE' : user.status,
      },
    });

    // 4. Create session and tokens
    const { session, tokens } = await this.createSessionAndTokens(user.id, req);

    // 5. Log security event
    await this.securityEventService.log('LOGIN_SUCCESS', {
      userId: user.id,
      ...ctx,
      metadata: { method: 'MOBILE_OTP', sessionId: session.id },
    });

    const fullUser = await this.loadUserWithRoles(user.id);
    return this.buildAuthResponse(fullUser, session.id, tokens, message);
  }

  /**
   * Direct send OTP helper
   */
  async sendOtp(mobileNumber: string, purpose: OtpPurpose, req?: any) {
    const ctx = this.extractRequestContext(req);
    await this.otpService.sendOtp(mobileNumber, purpose, ctx);
    return { message: 'OTP sent successfully' };
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. LEGACY PASSWORD LOGIN & GOOGLE AUTH
  // ═══════════════════════════════════════════════════════════════

  async loginWithEmail(email: string, password: string, req?: any) {
    const ctx = this.extractRequestContext(req);
    const normalizedEmail = email.toLowerCase().trim();

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: { userRoles: { include: { role: true } } },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    this.verifyAccountActive(user);

    const isPasswordValid = await this.passwordService.comparePassword(
      password,
      user.passwordHash!,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const { session, tokens } = await this.createSessionAndTokens(user.id, req);
    const fullUser = await this.loadUserWithRoles(user.id);

    return this.buildAuthResponse(fullUser, session.id, tokens, 'Login successful');
  }

  async loginWithStudentId(studentId: string, password: string, req?: any) {
    const ctx = this.extractRequestContext(req);
    const trimmedId = studentId.trim();

    const student = await this.prisma.student.findFirst({
      where: {
        OR: [
          { studentId: { equals: trimmedId, mode: 'insensitive' } },
          { studentCode: { equals: trimmedId, mode: 'insensitive' } },
        ],
      },
      include: {
        user: {
          include: {
            userRoles: { include: { role: true } },
          },
        },
      },
    });

    if (!student || !student.user || !student.user.passwordHash) {
      throw new UnauthorizedException('Invalid Student ID or password.');
    }

    const user = student.user;
    this.verifyAccountActive(user);

    const isPasswordValid = await this.passwordService.comparePassword(
      password,
      user.passwordHash!,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid Student ID or password.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const { session, tokens } = await this.createSessionAndTokens(user.id, req);
    const fullUser = await this.loadUserWithRoles(user.id);

    return this.buildAuthResponse(fullUser, session.id, tokens, 'Login successful');
  }

  async loginWithGoogle(idToken: string, req?: any) {
    const ctx = this.extractRequestContext(req);
    const payload = await this.oauthService.verifyGoogleIdToken(idToken);

    if (!payload.email) {
      throw new BadRequestException('Google token did not contain a valid email.');
    }

    const normalizedEmail = payload.email.toLowerCase().trim();

    let user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: { userRoles: { include: { role: true } } },
    });

    if (!user) {
      user = await this.prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            email: normalizedEmail,
            status: 'ACTIVE',
            isVerified: true,
            isActive: true,
            emailVerifiedAt: new Date(),
            lastLoginAt: new Date(),
          },
        });

        let studentRole = await tx.role.findUnique({ where: { name: 'STUDENT' } });
        if (!studentRole) {
          studentRole = await tx.role.create({ data: { name: 'STUDENT' } });
        }

        await tx.userRole.create({
          data: { userId: newUser.id, roleId: studentRole.id },
        });

        return tx.user.findUnique({
          where: { id: newUser.id },
          include: { userRoles: { include: { role: true } } },
        }) as any;
      });
    }

    if (!user) {
      throw new InternalServerErrorException('Failed to create or retrieve user.');
    }

    this.verifyAccountActive(user);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const { session, tokens } = await this.createSessionAndTokens(user.id, req);
    const fullUser = await this.loadUserWithRoles(user.id);

    return this.buildAuthResponse(fullUser, session.id, tokens, 'Google authentication successful');
  }

  // ═══════════════════════════════════════════════════════════════
  // 6. TOKEN REFRESH & LOGOUT
  // ═══════════════════════════════════════════════════════════════

  async refreshSession(refreshToken: string, req?: any) {
    const ctx = this.extractRequestContext(req);
    const tokens = await this.tokenService.refreshAccessTokens(refreshToken, ctx);

    let user: any = null;
    if (tokens.userId) {
      user = await this.loadUserWithRoles(tokens.userId);
    }

    return {
      message: 'Token refreshed successfully',
      data: {
        user: user ? this.buildUserResponse(user) : undefined,
        student: user?.student
          ? {
              id: user.student.id,
              studentId: user.student.studentId,
              studentCode: user.student.studentCode,
              name: user.student.name,
            }
          : null,
        session: tokens.sessionId ? { sessionId: tokens.sessionId } : undefined,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      },
    };
  }

  async logout(refreshToken: string, req?: any) {
    const ctx = this.extractRequestContext(req);
    const sessionId = await this.tokenService.revokeRefreshToken(refreshToken);
    if (sessionId) {
      await this.sessionService.revokeSession(sessionId);
    }
    const userId = req?.user?.userId;
    await this.securityEventService.log('LOGOUT', {
      userId,
      ...ctx,
      metadata: { sessionId },
    });
    return { message: 'Logged out successfully.' };
  }

  async logoutAll(userId: string, req?: any) {
    const ctx = this.extractRequestContext(req);
    await this.sessionService.revokeAllSessions(userId);
    await this.securityEventService.log('LOGOUT_ALL', { userId, ...ctx });
    return { message: 'All sessions logged out successfully.' };
  }

  // ═══════════════════════════════════════════════════════════════
  // 7. USER PROFILE & REGISTRATION OPTIONS
  // ═══════════════════════════════════════════════════════════════

  async getSessions(userId: string) {
    const sessions = await this.sessionService.getUserSessions(userId);
    return { message: 'Sessions retrieved successfully', data: sessions };
  }

  async revokeSession(userId: string, sessionId: string, req?: any) {
    const ctx = this.extractRequestContext(req);
    const success = await this.sessionService.revokeUserSession(userId, sessionId);
    if (!success) {
      throw new NotFoundException('Session not found.');
    }
    await this.securityEventService.log('SESSION_REVOKED', {
      userId,
      ...ctx,
      metadata: { revokedSessionId: sessionId },
    });
    return { message: 'Session revoked successfully.' };
  }

  async getMe(userId: string) {
    const user = await this.loadUserWithRoles(userId);
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const roles = user.userRoles.map((ur) => ur.role.name);

    return {
      id: user.id,
      phone: user.phone,
      mobileNumber: user.mobileNumber,
      email: user.email,
      status: user.status,
      isActive: user.isActive,
      isVerified: user.isVerified,
      lastLoginAt: user.lastLoginAt,
      roles,
      studentProfile: user.student
        ? {
            id: user.student.id,
            studentId: user.student.studentId,
            studentCode: user.student.studentCode,
            name: user.student.name,
            state: user.student.state,
            district: user.student.district,
            schoolCollege: user.student.schoolCollege,
            class: user.student.studentClass?.name,
            classId: user.student.classId,
            examTarget: user.student.examTarget?.name,
            examTargetId: user.student.examTargetId,
            preferredLanguage: user.student.preferredLanguage?.name,
            preferredLanguageId: user.student.preferredLanguageId,
            stateId: user.student.stateId,
            districtId: user.student.districtId,
            status: user.student.status,
          }
        : null,
    };
  }

  async getRegisterOptions() {
    const [classes, languages, examTargets, states] = await Promise.all([
      this.prisma.studentClass.findMany({ select: { id: true, name: true } }),
      this.prisma.preferredLanguage.findMany({
        where: { isActive: true },
        select: { id: true, name: true, code: true },
      }),
      this.prisma.examTarget.findMany({ select: { id: true, name: true } }),
      this.prisma.state.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          code: true,
          districts: {
            where: { isActive: true },
            select: { id: true, name: true, code: true },
            orderBy: { name: 'asc' },
          },
        },
        orderBy: { name: 'asc' },
      }),
    ]);

    return { classes, languages, examTargets, states };
  }
}
