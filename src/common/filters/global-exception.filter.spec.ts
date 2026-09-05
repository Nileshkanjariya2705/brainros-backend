import { GlobalExceptionFilter } from './global-exception.filter';
import { AppLoggerService } from '../logger/logger.service';
import { BadRequestException, InternalServerErrorException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let loggerService: AppLoggerService;

  beforeEach(() => {
    loggerService = new AppLoggerService();
    filter = new GlobalExceptionFilter(loggerService);
  });

  const createMockArgumentsHost = (request: any, response: any) => ({
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  });

  it('should format 400 BadRequestException with requestId and no stack trace in response', () => {
    const jsonMock = jest.fn();
    const statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    const response = { status: statusMock };
    const request = {
      id: 'req-400-test',
      url: '/api/v1/auth/login',
      method: 'POST',
      headers: {},
    };

    const host = createMockArgumentsHost(request, response) as any;
    const exception = new BadRequestException('Invalid email format');

    filter.catch(exception, host);

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(jsonMock).toHaveBeenCalled();
    const body = jsonMock.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.statusCode).toBe(400);
    expect(body.message).toBe('Invalid email format');
    expect(body.requestId).toBe('req-400-test');
    expect(body.stack).toBeUndefined(); // Stack MUST NOT be leaked to frontend
  });

  it('should handle 500 internal errors and never leak stack or sensitive queries to response', () => {
    const jsonMock = jest.fn();
    const statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    const response = { status: statusMock };
    const request = {
      id: 'req-500-test',
      url: '/api/v1/exams',
      method: 'POST',
      headers: {},
    };

    const host = createMockArgumentsHost(request, response) as any;
    const exception = new Error('Database connection failed on secret server');

    filter.catch(exception, host);

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = jsonMock.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.statusCode).toBe(500);
    expect(body.requestId).toBe('req-500-test');
    expect(body.stack).toBeUndefined();
  });

  it('should map Prisma unique constraint violation (P2002) to 409 Conflict', () => {
    const jsonMock = jest.fn();
    const statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    const response = { status: statusMock };
    const request = {
      id: 'req-prisma-test',
      url: '/api/v1/students',
      method: 'POST',
      headers: {},
    };

    const host = createMockArgumentsHost(request, response) as any;
    const prismaError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '6.0.0',
      meta: { target: ['email'] },
    });

    filter.catch(prismaError, host);

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    const body = jsonMock.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.statusCode).toBe(409);
    expect(body.error).toBe('Conflict');
    expect(body.requestId).toBe('req-prisma-test');
    expect(body.stack).toBeUndefined();
  });
});
