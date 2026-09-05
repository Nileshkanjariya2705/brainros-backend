import { Global, Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { AppLoggerService } from './logger.service';
import { RequestLoggerMiddleware } from './request-logger.middleware';

@Global()
@Module({
  providers: [AppLoggerService, RequestLoggerMiddleware],
  exports: [AppLoggerService, RequestLoggerMiddleware],
})
export class LoggerModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
