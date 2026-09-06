import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiErrorResponse } from '../interfaces/api-error.interface';
import { AppLoggerService } from '../logger/logger.service';
import { RequestContext } from '../logger/request-context';
import { InfrastructureStateService } from '../infrastructure/infrastructure-state.service';

@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly appLogger: AppLoggerService = new AppLoggerService(),
    private readonly infrastructureState?: InfrastructureStateService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error = 'Internal Server Error';
    let code: string | undefined = undefined;
    let details: any = null;
    let errorName = 'UnhandledException';

    const path = request.url;
    const method = request.method;
    const timestamp = new Date().toISOString();
    const requestId =
      request.id ||
      request.headers['x-request-id'] ||
      RequestContext.getRequestId() ||
      undefined;

    const user = request.user;
    const userId = user?.userId || user?.id || user?.sub || RequestContext.getUserId() || undefined;
    const role = user?.role || user?.roles?.[0]?.name || user?.userRoles?.[0]?.role?.name || RequestContext.getRole() || undefined;

    // 1. Handle NestJS HttpException (BadRequest, NotFound, Unauthorized, etc.)
    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      errorName = exception.name;
      const resBody = exception.getResponse();

      if (typeof resBody === 'object' && resBody !== null) {
        error = (resBody as any).error || exception.name;
        message = (resBody as any).message || exception.message;
        code = (resBody as any).code || undefined;
        details = (resBody as any).details || null;
      } else {
        message = exception.message || String(resBody);
      }
    }
    // 2. Handle Prisma Known Request Database Exceptions (Unique constraint, record missing, connection failures)
    else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      errorName = 'PrismaClientKnownRequestError';
      code = exception.code;
      const prismaMapping = this.handlePrismaError(exception);
      statusCode = prismaMapping.statusCode;
      message = prismaMapping.message;
      error = prismaMapping.error;
      details = prismaMapping.details;
    }
    // 3. Handle Other Prisma validation/initialization/panic errors
    else if (exception instanceof Prisma.PrismaClientValidationError) {
      errorName = 'PrismaClientValidationError';
      statusCode = HttpStatus.BAD_REQUEST;
      message = 'Database validation failed';
      error = 'Bad Request';
    } else if (exception instanceof Prisma.PrismaClientInitializationError) {
      this.infrastructureState?.setDatabaseState('DOWN', exception.message);
      errorName = 'PrismaClientInitializationError';
      statusCode = HttpStatus.SERVICE_UNAVAILABLE;
      message = 'Database service temporarily unavailable. Please retry shortly.';
      error = 'Service Unavailable';
    } else if (exception instanceof Prisma.PrismaClientRustPanicError) {
      this.infrastructureState?.setDatabaseState('DOWN', exception.message);
      errorName = 'PrismaClientRustPanicError';
      statusCode = HttpStatus.SERVICE_UNAVAILABLE;
      message = 'Database engine error. Service temporarily unavailable.';
      error = 'Service Unavailable';
    } else if (exception instanceof Prisma.PrismaClientUnknownRequestError) {
      errorName = 'PrismaClientUnknownRequestError';
      const msg = exception.message || '';
      if (
        msg.includes('Connection') ||
        msg.includes('connection') ||
        msg.includes('socket') ||
        msg.includes('timeout') ||
        msg.includes('terminated')
      ) {
        this.infrastructureState?.setDatabaseState('DOWN', msg);
        statusCode = HttpStatus.SERVICE_UNAVAILABLE;
        message = 'Database connection interrupted. Please try again shortly.';
        error = 'Service Unavailable';
      } else {
        statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
        message = 'A database request error occurred.';
        error = 'Internal Server Error';
      }
    }
    // 4. Handle Redis / BullMQ infrastructure errors gracefully
    else {
      const exMessage = exception instanceof Error ? exception.message : String(exception);
      errorName = exception instanceof Error ? exception.name : 'UnknownError';

      if (
        exMessage.includes('Connection is closed') ||
        exMessage.includes('ECONNREFUSED') ||
        exMessage.includes('enableOfflineQueue') ||
        exMessage.includes('Redis connection lost') ||
        exMessage.includes('connect ETIMEDOUT')
      ) {
        statusCode = HttpStatus.SERVICE_UNAVAILABLE;
        message = 'Infrastructure dependency temporarily unavailable. Please try again shortly.';
        error = 'Service Unavailable';
      } else {
        message = exMessage;
      }
    }

    // 5. Centralized Structured Logging
    const stack = exception instanceof Error ? exception.stack : undefined;
    this.appLogger.logError({
      message: `[${method}] ${path} ${statusCode} - ${message}`,
      errorName,
      errorCode: code,
      statusCode,
      method,
      path,
      userId,
      role,
      requestId,
      stack: statusCode >= 500 ? stack : undefined,
    });

    // 6. Safe response to client (NEVER returns stack traces, internal connection strings, or database hosts)
    const errorResponse: ApiErrorResponse = {
      success: false,
      statusCode,
      message,
      error,
      ...(code ? { code } : {}),
      details,
      timestamp,
      path,
      ...(requestId ? { requestId } : {}),
    };

    response.status(statusCode).json(errorResponse);
  }

  /**
   * Safe mapping of database-layer errors to client-layer HTTP responses
   */
  private handlePrismaError(err: Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P1000':
      case 'P1001':
      case 'P1002':
      case 'P1008':
      case 'P1011':
      case 'P1017':
        this.infrastructureState?.setDatabaseState('DOWN', err.message);
        return {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          message: 'Database service is temporarily unreachable. Please try again shortly.',
          error: 'Service Unavailable',
          details: null,
        };
      case 'P2002': {
        const fields = err.meta?.target || 'fields';
        return {
          statusCode: HttpStatus.CONFLICT,
          message: 'Duplicate entry detected for unique constraint.',
          error: 'Conflict',
          details: {
            constraint: 'UniqueConstraint',
            fields,
          },
        };
      }
      case 'P2025': {
        return {
          statusCode: HttpStatus.NOT_FOUND,
          message:
            (err.meta?.cause as string) || 'Requested record was not found.',
          error: 'Not Found',
          details: null,
        };
      }
      default:
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'A database error occurred.',
          error: 'Internal Server Error',
          details: { code: err.code },
        };
    }
  }
}
