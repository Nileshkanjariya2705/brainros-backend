import { Test, TestingModule } from '@nestjs/testing';
import { StudentController } from './student.controller';
import { StudentService } from './student.service';

describe('StudentController', () => {
  let controller: StudentController;
  let studentServiceMock: any;

  beforeEach(async () => {
    studentServiceMock = {
      getProfile: jest.fn().mockResolvedValue({ id: 's-1', name: 'Student 1' }),
      updateProfile: jest
        .fn()
        .mockResolvedValue({ id: 's-1', name: 'Updated Student' }),
      requestChangeMobile: jest.fn().mockResolvedValue({ requiresOtp: true }),
      verifyChangeMobile: jest.fn().mockResolvedValue({ success: true }),
      requestChangeEmail: jest.fn().mockResolvedValue({ requiresOtp: true }),
      verifyChangeEmail: jest.fn().mockResolvedValue({ success: true }),
      getSessions: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StudentController],
      providers: [{ provide: StudentService, useValue: studentServiceMock }],
    }).compile();

    controller = module.get<StudentController>(StudentController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should get current student profile', async () => {
    const res = await controller.getMyProfile({ user: { userId: 'u-1' } });
    expect(res.message).toBe('Student profile retrieved successfully');
    expect(res.data.name).toBe('Student 1');
  });

  it('should update student profile', async () => {
    const res = await controller.updateMyProfile(
      { user: { userId: 'u-1' }, ip: '127.0.0.1', headers: {} },
      { name: 'Updated Student' },
    );
    expect(res.message).toBe('Student profile updated successfully');
    expect(res.data.name).toBe('Updated Student');
  });
});
