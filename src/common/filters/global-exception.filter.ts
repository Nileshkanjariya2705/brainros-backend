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

@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly appLogger: AppLoggerService = new AppLoggerService()) {}

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
    // 2. Handle Prisma Known Request Database Exceptions (Unique constraint, record missing, etc.)
    else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      errorName = 'PrismaClientKnownRequestError';
      code = exception.code;
      const prismaMapping = this.handlePrismaError(exception);
      statusCode = prismaMapping.statusCode;
      message = prismaMapping.message;
      error = prismaMapping.error;
      details = prismaMapping.details;
    }
    // 3. Handle Other Prisma validation/initialization errors
    else if (exception instanceof Prisma.PrismaClientValidationError) {
      errorName = 'PrismaClientValidationError';
      statusCode = HttpStatus.BAD_REQUEST;
      message = 'Database validation failed';
      error = 'Bad Request';
    } else if (exception instanceof Prisma.PrismaClientInitializationError) {
      errorName = 'PrismaClientInitializationError';
      statusCode = HttpStatus.SERVICE_UNAVAILABLE;
      message = 'Database service temporarily unavailable';
      error = 'Service Unavailable';
    }
    // 4. Handle Unhandled/Generic code exceptions (e.g. TypeError, SyntaxError)
    else {
      errorName = exception instanceof Error ? exception.name : 'UnknownError';
      message = exception instanceof Error ? exception.message : String(exception);
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

    // 6. Safe response to client (NEVER returns stack traces or internal queries)
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
