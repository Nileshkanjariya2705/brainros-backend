import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiErrorResponse } from '../interfaces/api-error.interface';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error = 'Internal Server Error';
    let details: any = null;

    const path = request.url;
    const timestamp = new Date().toISOString();
    const requestId = request.headers['x-request-id'] || request.id || undefined;

    // 1. Handle NestJS HttpException (BadRequest, NotFound, etc.)
    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const resBody = exception.getResponse();

      if (typeof resBody === 'object' && resBody !== null) {
        error = (resBody as any).error || exception.name;
        message = (resBody as any).message || exception.message;
        details = (resBody as any).details || null;
      } else {
        message = exception.message || String(resBody);
      }
    }
    // 2. Handle Prisma Known Request Database Exceptions (Unique constraint, record missing, etc.)
    else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const prismaMapping = this.handlePrismaError(exception);
      statusCode = prismaMapping.statusCode;
      message = prismaMapping.message;
      error = prismaMapping.error;
      details = prismaMapping.details;
    }
    // 3. Handle Other Prisma validation/parsing errors
    else if (exception instanceof Prisma.PrismaClientValidationError) {
      statusCode = HttpStatus.BAD_REQUEST;
      message = 'Database validation failed';
      error = 'Bad Request';
    }
    // 4. Handle Unhandled/Generic code exceptions (e.g. TypeError, SyntaxError)
    else {
      this.logger.error(
        `Unhandled Exception: ${exception instanceof Error ? exception.message : String(exception)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    // Log general request details safely (omitting personal sensitive details or passwords)
    this.logRequestFailure(request, statusCode, exception);

    const errorResponse: ApiErrorResponse = {
      success: false,
      statusCode,
      message,
      error,
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
          message: (err.meta?.cause as string) || 'Requested record was not found.',
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

  /**
   * Log request context securely on the server
   */
  private logRequestFailure(request: any, status: number, exception: any) {
    const { method, url } = request;
    const userContext = request.user ? `User ID: ${request.user.userId}` : 'Unauthenticated';
    const exceptionMessage = exception instanceof Error ? exception.message : String(exception);
    
    const logMsg = `[${method}] ${url} - Status: ${status} - ${userContext} - Exception: ${exceptionMessage}`;

    if (status >= 500) {
      this.logger.error(logMsg);
    } else {
      this.logger.warn(logMsg);
    }
  }
}
