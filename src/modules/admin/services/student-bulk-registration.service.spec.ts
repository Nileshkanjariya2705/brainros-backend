import { Test, TestingModule } from '@nestjs/testing';
import { StudentBulkRegistrationService } from './student-bulk-registration.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SecurityEventService } from '../../auth/services/security-event.service';
import { OtpService } from '../../auth/services/otp.service';
import { BadRequestException } from '@nestjs/common';

describe('StudentBulkRegistrationService', () => {
  let service: StudentBulkRegistrationService;
  let prismaMock: any;
  let securityEventMock: any;
  let otpServiceMock: any;

  const mockSchool = {
    id: 'school-abc-123',
    name: 'ABC Public School',
    code: 'ABC001',
    status: 'ACTIVE',
  };

  beforeEach(async () => {
    prismaMock = {
      institution: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === 'school-abc-123') return Promise.resolve(mockSchool);
          if (where.id === 'school-inactive-123')
            return Promise.resolve({ ...mockSchool, id: 'school-inactive-123', status: 'INACTIVE' });
          return Promise.resolve(null);
        }),
        findMany: jest.fn().mockResolvedValue([mockSchool]),
      },
      institutionAdmin: {
        findFirst: jest.fn().mockResolvedValue({ id: 'admin-link-1' }),
      },
      state: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'state-gujarat-1', name: 'Gujarat', code: 'GJ', isActive: true },
          { id: 'state-maharashtra-1', name: 'Maharashtra', code: 'MH', isActive: true },
        ]),
      },
      district: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'dist-ahmedabad-1', stateId: 'state-gujarat-1', name: 'Ahmedabad', isActive: true },
          { id: 'dist-mumbai-1', stateId: 'state-maharashtra-1', name: 'Mumbai', isActive: true },
        ]),
      },
      studentClass: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'class-12-1', name: '12th' },
          { id: 'class-11-1', name: '11th' },
        ]),
      },
      examTarget: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'target-neet-1', name: 'NEET' },
          { id: 'target-jee-1', name: 'JEE_MAIN' },
        ]),
      },
      preferredLanguage: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'lang-eng-1', name: 'ENGLISH', code: 'en', isActive: true },
          { id: 'lang-hin-1', name: 'HINDI', code: 'hi', isActive: true },
        ]),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'user-new-1' }),
      },
      role: {
        findUnique: jest.fn().mockResolvedValue({ id: 'role-student-1', name: 'STUDENT' }),
        create: jest.fn().mockResolvedValue({ id: 'role-student-1', name: 'STUDENT' }),
      },
      userRole: {
        create: jest.fn().mockResolvedValue({ userId: 'user-new-1', roleId: 'role-student-1' }),
      },
      student: {
        count: jest.fn().mockResolvedValue(5),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'student-new-1', studentId: 'STU001006' }),
      },
      bulkUpload: {
        create: jest.fn().mockResolvedValue({ id: 'upload-123', status: 'VALIDATING', institutionId: 'school-abc-123' }),
        update: jest.fn().mockResolvedValue({ id: 'upload-123', status: 'READY_FOR_REVIEW' }),
        findUnique: jest.fn().mockResolvedValue({ id: 'upload-123', institutionId: 'school-abc-123', institution: mockSchool }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      bulkUploadRow: {
        create: jest.fn().mockResolvedValue({ id: 'row-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({ id: 'row-1' }),
      },
      bulkUploadError: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn().mockImplementation((cb) => cb(prismaMock)),
    };

    securityEventMock = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    otpServiceMock = {
      normalizeMobileNumber: jest.fn((m) => (m.startsWith('+') ? m : `+91${m.replace(/\D/g, '')}`)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StudentBulkRegistrationService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: SecurityEventService, useValue: securityEventMock },
        { provide: OtpService, useValue: otpServiceMock },
      ],
    }).compile();

    service = module.get<StudentBulkRegistrationService>(StudentBulkRegistrationService);
  });

  describe('generateTemplate', () => {
    it('should generate CSV template with student headers and NO school_name column', async () => {
      const { buffer, fileName, mimeType } = await service.generateTemplate('csv');
      expect(fileName).toBe('student_bulk_registration_template.csv');
      expect(mimeType).toBe('text/csv');
      expect(buffer.length).toBeGreaterThan(0);
      const content = buffer.toString();
      expect(content).toContain('Full Name');
      expect(content).toContain('Mobile Number');
      expect(content).toContain('State');
      expect(content).toContain('City');
      expect(content).not.toContain('School / College / Institution');
    });

    it('should generate XLSX template without school_name column', async () => {
      const { buffer, fileName, mimeType } = await service.generateTemplate('xlsx');
      expect(fileName).toBe('student_bulk_registration_template.xlsx');
      expect(mimeType).toContain('spreadsheet');
      expect(buffer.length).toBeGreaterThan(0);
    });
  });

  describe('validateFile', () => {
    it('should throw if file is missing', () => {
      expect(() => service.validateFile(null as any)).toThrow(BadRequestException);
    });

    it('should throw if file extension is unsupported', () => {
      const invalidFile = { originalname: 'students.txt', size: 100 } as any;
      expect(() => service.validateFile(invalidFile)).toThrow(/Invalid file format/);
    });

    it('should throw if file size exceeds 10MB', () => {
      const hugeFile = { originalname: 'students.xlsx', size: 15 * 1024 * 1024 } as any;
      expect(() => service.validateFile(hugeFile)).toThrow(/exceeds maximum limit/);
    });
  });

  describe('uploadAndValidate', () => {
    it('should throw BadRequestException if schoolId is missing', async () => {
      const csvContent =
        'Full Name,Mobile Number,Email,State,City,Class,Exam Target,Preferred Language\n' +
        'Rohan Shah,9876543210,rohan@example.com,Gujarat,Ahmedabad,12th,NEET,ENGLISH';

      const file = {
        originalname: 'students.csv',
        buffer: Buffer.from(csvContent),
        size: csvContent.length,
      } as any;

      await expect(service.uploadAndValidate(file, { userId: 'admin-1' })).rejects.toThrow(
        /Please select a school before uploading students/,
      );
    });

    it('should throw BadRequestException if school does not exist', async () => {
      const csvContent =
        'Full Name,Mobile Number,Email,State,City,Class,Exam Target,Preferred Language\n' +
        'Rohan Shah,9876543210,rohan@example.com,Gujarat,Ahmedabad,12th,NEET,ENGLISH';

      const file = {
        originalname: 'students.csv',
        buffer: Buffer.from(csvContent),
        size: csvContent.length,
      } as any;

      await expect(
        service.uploadAndValidate(file, { userId: 'admin-1' }, { schoolId: 'non-existent-school' }),
      ).rejects.toThrow(/Selected school does not exist/);
    });

    it('should throw BadRequestException if school is inactive', async () => {
      const csvContent =
        'Full Name,Mobile Number,Email,State,City,Class,Exam Target,Preferred Language\n' +
        'Rohan Shah,9876543210,rohan@example.com,Gujarat,Ahmedabad,12th,NEET,ENGLISH';

      const file = {
        originalname: 'students.csv',
        buffer: Buffer.from(csvContent),
        size: csvContent.length,
      } as any;

      await expect(
        service.uploadAndValidate(file, { userId: 'admin-1' }, { schoolId: 'school-inactive-123' }),
      ).rejects.toThrow(/Selected school is inactive/);
    });

    it('should validate valid student rows and assign selected school relationship', async () => {
      const csvContent =
        'Full Name,Mobile Number,Email,State,City,Class,Exam Target,Preferred Language\n' +
        'Rohan Shah,9876543210,rohan@example.com,Gujarat,Ahmedabad,12th,NEET,ENGLISH';

      const file = {
        originalname: 'students.csv',
        buffer: Buffer.from(csvContent),
        size: csvContent.length,
      } as any;

      const res = await service.uploadAndValidate(
        file,
        { userId: 'admin-1', roles: ['SUPER_ADMIN'] },
        { schoolId: 'school-abc-123' },
      );

      expect(res.totalRows).toBe(1);
      expect(res.validRows).toBe(1);
      expect(res.invalidRows).toBe(0);
      expect(res.duplicateRows).toBe(0);
      expect(prismaMock.bulkUpload.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            institutionId: 'school-abc-123',
          }),
        }),
      );
    });

    it('should ignore school_name inside CSV file and enforce selected UI school', async () => {
      const csvContent =
        'Full Name,Mobile Number,Email,State,City,Class,Exam Target,Preferred Language,School Name\n' +
        'Rohan Shah,9876543210,rohan@example.com,Gujarat,Ahmedabad,12th,NEET,ENGLISH,XYZ Legacy School';

      const file = {
        originalname: 'students.csv',
        buffer: Buffer.from(csvContent),
        size: csvContent.length,
      } as any;

      const res = await service.uploadAndValidate(
        file,
        { userId: 'admin-1', roles: ['SUPER_ADMIN'] },
        { schoolId: 'school-abc-123' },
      );

      expect(res.totalRows).toBe(1);
      expect(res.validRows).toBe(1);
      const rowCall = prismaMock.bulkUploadRow.create.mock.calls[0][0];
      expect(rowCall.data.normalizedData.institutionId).toBe('school-abc-123');
      expect(rowCall.data.normalizedData.schoolCollege).toBe('ABC Public School');
    });

    it('should flag in-file duplicates', async () => {
      const csvContent =
        'Full Name,Mobile Number,Email,State,City,Class,Exam Target,Preferred Language\n' +
        'Rohan Shah,9876543210,rohan@example.com,Gujarat,Ahmedabad,12th,NEET,ENGLISH\n' +
        'Another Rohan,9876543210,another@example.com,Gujarat,Ahmedabad,12th,NEET,ENGLISH';

      const file = {
        originalname: 'students.csv',
        buffer: Buffer.from(csvContent),
        size: csvContent.length,
      } as any;

      const res = await service.uploadAndValidate(
        file,
        { userId: 'admin-1', roles: ['SUPER_ADMIN'] },
        { schoolId: 'school-abc-123' },
      );

      expect(res.totalRows).toBe(2);
      expect(res.validRows).toBe(1);
      expect(res.invalidRows).toBe(1);
      expect(res.duplicateRows).toBe(1);
    });
  });
});
