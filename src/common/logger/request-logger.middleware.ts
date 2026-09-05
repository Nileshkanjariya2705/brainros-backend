import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { AppLoggerService } from './logger.service';
import { RequestContext } from './request-context';
import { getSlowRequestThreshold, shouldLogRequestBody, SENSITIVE_PATH_PATTERNS, redactSensitiveData } from './logger.config';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  constructor(private readonly logger: AppLoggerService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const startTime = Date.now();

    // 1. Sanitize or Generate Request ID
    let rawRequestId = req.headers['x-request-id'];
    let requestId: string;

    if (typeof rawRequestId === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(rawRequestId.trim())) {
      requestId = rawRequestId.trim();
    } else {
      requestId = crypto.randomUUID();
    }

    // Attach to request and response
    (req as any).id = requestId;
    res.setHeader('X-Request-ID', requestId);

    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'unknown';
    const userAgent = (req.headers['user-agent'] as string) || 'unknown';

    // 2. Wrap downstream handling in RequestContext
    RequestContext.run(
      {
        requestId,
        ip: clientIp,
        userAgent,
      },
      () => {
        // Response completion hook
        res.on('finish', () => {
          const durationMs = Date.now() - startTime;
          const statusCode = res.statusCode;
          const path = req.originalUrl || req.url;
          const method = req.method;

          // Retrieve user context if authenticated
          const user = (req as any).user;
          const userId = user?.userId || user?.id || user?.sub || undefined;
          const role = user?.role || user?.roles?.[0]?.name || user?.userRoles?.[0]?.role?.name || undefined;

          // Update RequestContext store for any lingering tasks
          if (userId) RequestContext.set('userId', userId);
          if (role) RequestContext.set('role', role);

          // Check if request is a health probe
          const isHealthProbe = path.startsWith('/health');
          if (isHealthProbe && statusCode < 400) {
            this.logger.debug(
              {
                method,
                path,
                statusCode,
                durationMs,
                ip: clientIp,
                userAgent,
                requestId,
              },
              'HealthCheck',
            );
            return;
          }

          // Slow request warning check
          const slowThreshold = getSlowRequestThreshold();
          const isSlow = durationMs > slowThreshold;

          // Optional safe body logging (strictly excluded for auth/password/otp endpoints)
          let safeBody: any = undefined;
          if (shouldLogRequestBody()) {
            const isSensitivePath = SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(path));
            if (!isSensitivePath && req.body && typeof req.body === 'object') {
              safeBody = redactSensitiveData(req.body);
            }
          }

          this.logger.logHttp({
            method,
            path,
            statusCode,
            durationMs,
            ip: clientIp,
            userAgent,
            userId,
            role,
            requestId,
            ...(isSlow ? { slowRequest: true, thresholdMs: slowThreshold } : {}),
            ...(safeBody ? { body: safeBody } : {}),
          });
        });

        next();
      },
    );
  }
}
