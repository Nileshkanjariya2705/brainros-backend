import { Test, TestingModule } from '@nestjs/testing';
import { BulkUploadValidatorService } from './bulk-upload-validator.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('BulkUploadValidatorService', () => {
  let service: BulkUploadValidatorService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bulkUploadRow: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
      bulkUploadError: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      bulkUpload: {
        update: jest.fn(),
      },
      user: {
        findFirst: jest.fn(),
      },
      batchStudent: {
        findUnique: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BulkUploadValidatorService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<BulkUploadValidatorService>(BulkUploadValidatorService);
  });

  it('should identify valid and invalid rows accurately', async () => {
    const mockRows = [
      {
        id: 'row-1',
        rowNumber: 1,
        normalizedData: {
          name: 'Valid Student',
          mobile: '9876543210',
          email: 'valid@example.com',
        },
      },
      {
        id: 'row-2',
        rowNumber: 2,
        normalizedData: {
          name: 'A', // Too short
          mobile: '12345', // Invalid mobile
          email: 'not-an-email',
        },
      },
      {
        id: 'row-3',
        rowNumber: 3,
        normalizedData: {
          name: 'Duplicate Student',
          mobile: '9876543210', // In-file duplicate of row 1
          email: 'dup@example.com',
        },
      },
    ];

    prisma.bulkUploadRow.findMany.mockResolvedValue(mockRows);
    prisma.user.findFirst.mockResolvedValue(null);

    await service.validateUpload('upload-1');

    expect(prisma.bulkUploadError.deleteMany).toHaveBeenCalledWith({
      where: { uploadId: 'upload-1' },
    });

    expect(prisma.bulkUpload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'upload-1' },
        data: expect.objectContaining({
          validRowCount: 1,
          invalidRowCount: 2,
          duplicateRowCount: 1,
          status: 'READY_FOR_REVIEW',
        }),
      }),
    );
  });
});
