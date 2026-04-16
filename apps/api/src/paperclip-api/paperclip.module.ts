import { Module } from '@nestjs/common';
import { PaperclipController } from './paperclip.controller';

@Module({
  controllers: [PaperclipController],
})
export class PaperclipModule {}
