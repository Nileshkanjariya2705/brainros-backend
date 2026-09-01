import { Module } from '@nestjs/common';
import { AcademicController } from './academic.controller';
import { AcademicService } from './academic.service';
import { RedisModule } from '../redis/redis.module';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [RedisModule, AdminModule],
  controllers: [AcademicController],
  providers: [AcademicService],
  exports: [AcademicService],
})
export class AcademicModule {}
