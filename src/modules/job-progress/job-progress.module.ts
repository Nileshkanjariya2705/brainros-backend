import { Global, Module } from '@nestjs/common';
import { JobProgressGateway } from './gateways/job-progress.gateway';
import { JobProgressService } from './services/job-progress.service';
import { JobProgressController } from './controllers/job-progress.controller';
import { AuthModule } from '../auth/auth.module';
import { RedisModule } from '../redis/redis.module';

@Global()
@Module({
  imports: [AuthModule, RedisModule],
  controllers: [JobProgressController],
  providers: [JobProgressGateway, JobProgressService],
  exports: [JobProgressGateway, JobProgressService],
})
export class JobProgressModule {}
