import { Test, TestingModule } from '@nestjs/testing';
import { AdminStudentsService } from './admin-students.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SortOrderEnum } from '../dto/admin-students.dto';

describe('AdminStudentsService', () => {
  let service: AdminStudentsService;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    userRole: {
      create: jest.fn(),
    },
    role: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    student: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    state: {
      findMany: jest.fn(),
    },
    district: {
      findMany: jest.fn(),
    },
    studentClass: {
      findMany: jest.fn(),
    },
    examTarget: {
      findMany: jest.fn(),
    },
    institution: {
      findMany: jest.fn(),
    },
    parentStudentLink: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminStudentsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<AdminStudentsService>(AdminStudentsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getStudents', () => {
    it('should return server-side paginated students and correct metadata', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'admin-1',
        userRoles: [{ role: { name: 'SUPER_ADMIN' } }],
        institutionAdmins: [],
      });

      const mockStudents = [
        {
          id: 'student-1',
          studentId: 'BRN-10001',
          studentCode: 'BRN-10001',
          name: 'Rahul Patel',
          state: 'Gujarat',
          district: 'Ahmedabad',
          schoolCollege: 'DPS Ahmedabad',
          status: 'ACTIVE',
          createdAt: new Date('2026-09-04T10:00:00Z'),
          updatedAt: new Date('2026-09-04T10:00:00Z'),
          user: {
            id: 'u-1',
            email: 'rahul@example.com',
            mobileNumber: '9876543210',
            phone: '9876543210',
            status: 'ACTIVE',
            isActive: true,
          },
          studentClass: { id: 'c-1', name: 'Class 12' },
          examTarget: { id: 't-1', name: 'NEET' },
          stateRef: { id: 's-1', name: 'Gujarat', code: 'GJ' },
          districtRef: { id: 'd-1', name: 'Ahmedabad', code: 'AHM' },
          batchMemberships: [],
          parentLinks: [{ id: 'pl-1', parentId: 'p-1', relationshipType: 'FATHER' }],
        },
      ];

      mockPrismaService.student.findMany.mockResolvedValue(mockStudents);
      mockPrismaService.student.count.mockResolvedValue(1);

      const result = await service.getStudents(
        {
          page: 1,
          pageSize: 20,
          sortBy: 'createdAt',
          sortOrder: SortOrderEnum.DESC,
        },
        'admin-1',
      );

      expect(result.items).toHaveLength(1);
      expect(result.items[0].studentId).toBe('BRN-10001');
      expect(result.items[0].hasParent).toBe(true);
      expect(result.items[0].parentsCount).toBe(1);
      expect(result.pagination).toEqual({
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      });
    });
  });

  describe('getFilterOptions', () => {
    it('should return master data options', async () => {
      mockPrismaService.state.findMany.mockResolvedValue([{ id: 's-1', name: 'Gujarat', code: 'GJ' }]);
      mockPrismaService.district.findMany.mockResolvedValue([{ id: 'd-1', name: 'Ahmedabad', code: 'AHM', stateId: 's-1' }]);
      mockPrismaService.studentClass.findMany.mockResolvedValue([{ id: 'c-1', name: 'Class 12' }]);
      mockPrismaService.examTarget.findMany.mockResolvedValue([{ id: 't-1', name: 'NEET' }]);
      mockPrismaService.institution.findMany.mockResolvedValue([{ id: 'i-1', name: 'Allen Ahmedabad', code: 'ALN01' }]);

      const options = await service.getFilterOptions();

      expect(options.states).toHaveLength(1);
      expect(options.districts).toHaveLength(1);
      expect(options.classes).toHaveLength(1);
      expect(options.examTargets).toHaveLength(1);
      expect(options.institutions).toHaveLength(1);
      expect(options.statuses).toHaveLength(5);
    });
  });

  describe('getStudentParents', () => {
    it('should return linked parents for a student', async () => {
      mockPrismaService.student.findFirst.mockResolvedValue({
        id: 'student-1',
        studentId: 'BRN-10001',
        studentCode: 'BRN-10001',
        name: 'Rahul Patel',
      });

      mockPrismaService.parentStudentLink.findMany.mockResolvedValue([
        {
          id: 'link-1',
          parentId: 'parent-1',
          relationshipType: 'FATHER',
          status: 'ACTIVE',
          linkedAt: new Date('2026-09-04T10:00:00Z'),
          revokedAt: null,
          parent: {
            id: 'parent-1',
            email: 'rajesh@example.com',
            mobileNumber: '9876543210',
            phone: '9876543210',
            isActive: true,
            status: 'ACTIVE',
          },
        },
      ]);

      const result = await service.getStudentParents('student-1');

      expect(result.student.studentId).toBe('BRN-10001');
      expect(result.parents).toHaveLength(1);
      expect(result.parents[0].relationship).toBe('FATHER');
      expect(result.parents[0].mobile).toBe('9876543210');
    });
  });

  describe('addParentToStudent', () => {
    it('should create a new parent user and link if user does not exist', async () => {
      mockPrismaService.student.findFirst.mockResolvedValue({
        id: 'student-1',
        studentId: 'BRN-10001',
        name: 'Rahul Patel',
      });

      mockPrismaService.role.findUnique.mockResolvedValue({ id: 'r-parent', name: 'PARENT' });
      mockPrismaService.user.findFirst.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue({
        id: 'user-p-new',
        email: 'rajesh@example.com',
        mobileNumber: '9876543210',
      });

      mockPrismaService.parentStudentLink.findUnique.mockResolvedValue(null);
      mockPrismaService.parentStudentLink.create.mockResolvedValue({
        id: 'link-new',
        parentId: 'user-p-new',
        studentId: 'student-1',
        relationshipType: 'FATHER',
        status: 'ACTIVE',
        linkedAt: new Date('2026-09-04T10:00:00Z'),
      });

      const result = await service.addParentToStudent(
        'student-1',
        {
          name: 'Rajesh Patel',
          mobile: '9876543210',
          email: 'rajesh@example.com',
          relationship: 'FATHER' as any,
        },
        'admin-1',
      );

      expect(result.message).toBe('Parent linked successfully.');
      expect(result.data.parentId).toBe('user-p-new');
      expect(result.data.relationship).toBe('FATHER');
    });
  });

  describe('revokeParentLink', () => {
    it('should revoke an existing parent link', async () => {
      mockPrismaService.student.findFirst.mockResolvedValue({
        id: 'student-1',
        studentId: 'BRN-10001',
        name: 'Rahul Patel',
      });

      mockPrismaService.parentStudentLink.findFirst.mockResolvedValue({
        id: 'link-1',
        studentId: 'student-1',
        status: 'ACTIVE',
      });

      mockPrismaService.parentStudentLink.update.mockResolvedValue({
        id: 'link-1',
        status: 'REVOKED',
        revokedAt: new Date(),
      });

      const result = await service.revokeParentLink('student-1', 'link-1', 'admin-1');

      expect(result.message).toBe('Parent link revoked successfully.');
    });
  });
});
