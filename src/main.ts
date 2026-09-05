import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { AppLoggerService } from './common/logger/logger.service';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

// Global error handlers to prevent silent process death
const bootstrapLogger = new AppLoggerService();
bootstrapLogger.setContext('Bootstrap');

process.on('unhandledRejection', (reason: any) => {
  bootstrapLogger.error(
    `Unhandled Promise Rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
    reason instanceof Error ? reason.stack : undefined,
    'UnhandledRejection',
  );
});

process.on('uncaughtException', (error: Error) => {
  bootstrapLogger.fatal(`Uncaught Exception: ${error.message}`, error.stack, 'UncaughtException');
});

/**
 * Validates critical environment variables at startup.
 */
function validateEnvironment(logger: AppLoggerService) {
  const required = ['DATABASE_URL'];
  const missing: string[] = [];

  for (const envVar of required) {
    if (!process.env[envVar] || process.env[envVar]!.trim() === '') {
      missing.push(envVar);
    }
  }

  if (missing.length > 0) {
    logger.error(
      `[FATAL CONFIG ERROR] Missing required environment variable(s): ${missing.join(', ')}. Please check your .env configuration.`,
      undefined,
      'ConfigValidation',
    );
  }

  if (
    process.env.NODE_ENV === 'production' &&
    (!process.env.JWT_SECRET ||
      process.env.JWT_SECRET === 'super-secret-jwt-key-replace-in-production')
  ) {
    logger.warn(
      '[SECURITY WARNING] Running in production with default/missing JWT_SECRET. Please set a dedicated JWT_SECRET in environment variables.',
      'ConfigValidation',
    );
  }
}

async function bootstrap() {
  validateEnvironment(bootstrapLogger);

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const appLogger = app.get(AppLoggerService);
  app.useLogger(appLogger);

  // Enable graceful shutdown hooks for SIGTERM / SIGINT
  app.enableShutdownHooks();

  // Security middlewares
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cookieParser());

  // CORS Configuration
  const allowedOrigins = [
    'https://brainros.com',
    'https://www.brainros.com',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
  ];

  if (process.env.FRONTEND_URL) {
    const envOrigins = process.env.FRONTEND_URL.split(',').map((o) => o.trim());
    for (const o of envOrigins) {
      if (o && !allowedOrigins.includes(o)) {
        allowedOrigins.push(o);
      }
    }
  }

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server, health check probes)
      if (!origin) {
        return callback(null, true);
      }
      if (
        allowedOrigins.includes(origin) ||
        process.env.NODE_ENV !== 'production'
      ) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'X-Requested-With',
      'Cookie',
      'x-request-id',
    ],
    credentials: true,
    optionsSuccessStatus: 204,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors) => {
        const formattedErrors = errors.map((err) => ({
          field: err.property,
          messages: Object.values(err.constraints || {}),
        }));
        return new BadRequestException({
          message: 'Validation failed',
          error: 'Bad Request',
          details: formattedErrors,
        });
      },
    }),
  );

  // Register global HTTP response formatting interceptor
  app.useGlobalInterceptors(new ResponseInterceptor());

  // Register global unhandled exception and database error filter with centralized logger
  app.useGlobalFilters(new GlobalExceptionFilter(appLogger));

  const port = process.env.PORT || 3000;
  await app.listen(port);
  appLogger.log(`Application started successfully on port ${port} (env: ${process.env.NODE_ENV || 'development'})`, 'Bootstrap');
}
bootstrap();
