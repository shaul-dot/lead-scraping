import { Module } from '@nestjs/common';
import { DomainService } from './domain.service';
import { InboxService } from './inbox.service';
import { DeliverabilityController } from './deliverability.controller';
import { AlertModule } from '../alert/alert.module';

@Module({
  imports: [AlertModule],
  providers: [DomainService, InboxService],
  controllers: [DeliverabilityController],
  exports: [DomainService, InboxService],
})
export class DeliverabilityModule {}
