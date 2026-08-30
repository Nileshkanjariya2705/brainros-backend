import { Test, TestingModule } from '@nestjs/testing';
import { StudentService } from './student.service';
import { PrismaService } from '../prisma/prisma.service';
import { SecurityEventService } from '../auth/services/security-event.service';
import { OtpService } from '../auth/services/otp.service';
import { RedisService } from '../redis/redis.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('StudentService (Profile & Contact Management)', () => {
  let studentService: StudentService;
  let prismaMock: any;
  let securityEventServiceMock: any;
  let otpServiceMock: any;
  let redisServiceMock: any;

  const mockRedisStorage = new Map<string, string>();

  beforeEach(async () => {
    mockRedisStorage.clear();

    redisServiceMock = {
      get: jest
        .fn()
        .mockImplementation(
          async (key: string) => mockRedisStorage.get(key) || null,
        ),
      set: jest.fn().mockImplementation(async (key: string, val: string) => {
        mockRedisStorage.set(key, val);
      }),
      del: jest.fn().mockImplementation(async (key: string) => {
        mockRedisStorage.delete(key);
      }),
    };

    otpServiceMock = {
      normalizeMobileNumber: jest.fn().mockImplementation((m: string) => {
        const clean = m.replace(/[^\d+]/g, '');
        return clean.startsWith('+') ? clean : `+91${clean}`;
      }),
      sendOtp: jest.fn().mockResolvedValue(undefined),
      verifyOtp: jest.fn().mockResolvedValue(true),
    };

    securityEventServiceMock = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    prismaMock = {
      student: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      studentClass: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'class-1', name: 'Class 12' }),
      },
      examTarget: {
        findUnique: jest.fn().mockResolvedValue({ id: 'exam-1', name: 'NEET' }),
      },
      preferredLanguage: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'lang-1', name: 'English', isActive: true }),
      },
      state: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'state-1',
          name: 'Karnataka',
          isActive: true,
        }),
      },
      district: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'dist-1',
          name: 'Bengaluru',
          stateId: 'state-1',
        }),
      },
      loginSession: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StudentService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: SecurityEventService, useValue: securityEventServiceMock },
        { provide: OtpService, useValue: otpServiceMock },
        { provide: RedisService, useValue: redisServiceMock },
      ],
    }).compile();

    studentService = module.get<StudentService>(StudentService);
  });

  describe('1. Profile Retrieval & Update', () => {
    it('should retrieve student profile for authenticated user', async () => {
      prismaMock.student.findUnique.mockResolvedValue({
        id: 'student-id-1',
        userId: 'user-id-1',
        studentCode: 'BRN-2026-000001',
        name: 'Aarav Sharma',
      });

      const res = await studentService.getProfile('user-id-1');
      expect(res.studentCode).toBe('BRN-2026-000001');
    });

    it('should throw NotFoundException if profile does not exist', async () => {
      prismaMock.student.findUnique.mockResolvedValue(null);
      await expect(studentService.getProfile('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should update permitted fields and validate master records', async () => {
      prismaMock.student.findUnique.mockResolvedValue({
        id: 'student-id-1',
        userId: 'user-id-1',
        state: 'Karnataka',
        district: 'Bengaluru',
      });
      prismaMock.student.update.mockResolvedValue({
        id: 'student-id-1',
        userId: 'user-id-1',
        name: 'Aarav Updated',
        schoolCollege: 'New School',
      });

      const res = await studentService.updateProfile('user-id-1', {
        name: 'Aarav Updated',
        schoolCollege: 'New School',
        classId: 'class-1',
        preferredLanguageId: 'lang-1',
      });

      expect(prismaMock.student.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Aarav Updated',
            schoolCollege: 'New School',
          }),
        }),
      );
      expect(res.name).toBe('Aarav Updated');
    });

    it('should reject district that does not belong to the selected state', async () => {
      prismaMock.student.findUnique.mockResolvedValue({
        id: 'student-id-1',
        userId: 'user-id-1',
        stateId: 'state-1',
      });
      prismaMock.district.findUnique.mockResolvedValue({
        id: 'dist-2',
        name: 'Mumbai',
        stateId: 'state-maharashtra',
      });

      await expect(
        studentService.updateProfile('user-id-1', {
          stateId: 'state-1',
          districtId: 'dist-2',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('2. Mobile Number Change (OTP Verified)', () => {
    it('should request mobile change and send OTP to new mobile', async () => {
      prismaMock.user.findFirst.mockResolvedValue(null);

      const res = await studentService.requestChangeMobile('user-id-1', {
        newMobileNumber: '+919999988888',
      });

      expect(res.data.requiresOtp).toBe(true);
      expect(res.data.purpose).toBe('CHANGE_MOBILE');
      expect(otpServiceMock.sendOtp).toHaveBeenCalledWith(
        '+919999988888',
        'CHANGE_MOBILE',
        expect.any(Object),
      );
      expect(mockRedisStorage.has('mobile-change:user-id-1')).toBe(true);
    });

    it('should reject mobile change if new number is already in use', async () => {
      prismaMock.user.findFirst.mockResolvedValue({ id: 'other-user-id' });

      await expect(
        studentService.requestChangeMobile('user-id-1', {
          newMobileNumber: '+919999988888',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should verify mobile change OTP and update user record', async () => {
      mockRedisStorage.set(
        'mobile-change:user-id-1',
        JSON.stringify({ newMobile: '+919999988888' }),
      );

      prismaMock.user.update.mockResolvedValue({
        id: 'user-id-1',
        mobileNumber: '+919999988888',
        mobileVerifiedAt: new Date(),
      });

      const res = await studentService.verifyChangeMobile('user-id-1', {
        otp: '12345',
      });

      expect(otpServiceMock.verifyOtp).toHaveBeenCalledWith(
        '+919999988888',
        '12345',
        'CHANGE_MOBILE',
        expect.any(Object),
      );
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-id-1' },
          data: expect.objectContaining({ mobileNumber: '+919999988888' }),
        }),
      );
      expect(res.data.mobileNumber).toBe('+919999988888');
      expect(mockRedisStorage.has('mobile-change:user-id-1')).toBe(false);
    });
  });

  describe('3. Email Change (OTP Verified)', () => {
    it('should request email change and send verification OTP to user mobile', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null); // uniqueness check
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 'user-id-1',
        mobileNumber: '+919000000001',
      });

      const res = await studentService.requestChangeEmail('user-id-1', {
        newEmail: 'newemail@test.com',
      });

      expect(res.data.requiresOtp).toBe(true);
      expect(res.data.purpose).toBe('VERIFY_EMAIL');
      expect(otpServiceMock.sendOtp).toHaveBeenCalledWith(
        '+919000000001',
        'VERIFY_EMAIL',
        expect.any(Object),
      );
      expect(mockRedisStorage.has('email-change:user-id-1')).toBe(true);
    });

    it('should verify email change OTP and update user email', async () => {
      mockRedisStorage.set(
        'email-change:user-id-1',
        JSON.stringify({ newEmail: 'newemail@test.com' }),
      );
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-id-1',
        mobileNumber: '+919000000001',
      });
      prismaMock.user.update.mockResolvedValue({
        id: 'user-id-1',
        email: 'newemail@test.com',
        emailVerifiedAt: new Date(),
      });

      const res = await studentService.verifyChangeEmail('user-id-1', {
        otp: '12345',
      });

      expect(otpServiceMock.verifyOtp).toHaveBeenCalledWith(
        '+919000000001',
        '12345',
        'VERIFY_EMAIL',
        expect.any(Object),
      );
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-id-1' },
          data: expect.objectContaining({ email: 'newemail@test.com' }),
        }),
      );
      expect(res.data.email).toBe('newemail@test.com');
      expect(mockRedisStorage.has('email-change:user-id-1')).toBe(false);
    });
  });
});
