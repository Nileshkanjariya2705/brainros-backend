import { Global, Module } from '@nestjs/common';
import { InfrastructureStateService } from './infrastructure-state.service';

@Global()
@Module({
  providers: [InfrastructureStateService],
  exports: [InfrastructureStateService],
})
export class InfrastructureModule {}
