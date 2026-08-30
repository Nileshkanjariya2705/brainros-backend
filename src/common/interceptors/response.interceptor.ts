import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponse } from '../interfaces/api-response.interface';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    const ctx = context.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    return next.handle().pipe(
      map((result) => {
        const statusCode = response.statusCode;
        const path = request.url;
        const timestamp = new Date().toISOString();
        const requestId =
          request.headers['x-request-id'] || request.id || undefined;

        // If the status code is 204 (No Content), bypass response formatting to maintain correct HTTP protocol
        if (statusCode === 204) {
          return result;
        }

        let message = 'Request successful';
        let data: any = result;
        let meta: any = null;

        // Extract nested data, message, and metadata if the controller returned a structured helper object
        if (
          result &&
          typeof result === 'object' &&
          ('data' in result || 'message' in result || 'meta' in result)
        ) {
          message = result.message || message;
          data = result.data !== undefined ? result.data : null;
          meta = result.meta || null;
        }

        return {
          success: true,
          statusCode,
          message,
          data,
          meta,
          timestamp,
          path,
          ...(requestId ? { requestId } : {}),
        };
      }),
    );
  }
}
