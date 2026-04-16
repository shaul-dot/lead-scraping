import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { SourceService } from './source.service';
import type { Source, SourceTier } from '@hyperscale/types';

@Controller('sources')
export class SourceController {
  constructor(private readonly sourceService: SourceService) {}

  @Get()
  async listAll() {
    return this.sourceService.getSourceHealth();
  }

  @Get(':source/config')
  async getConfig(@Param('source') source: Source) {
    return this.sourceService.getSourceConfig(source);
  }

  @Post(':source/switch-tier')
  async switchTier(
    @Param('source') source: Source,
    @Body() body: { toTier: SourceTier; reason: string },
  ) {
    await this.sourceService.executeTierSwitch(
      source,
      body.toTier,
      body.reason,
    );
    return { success: true };
  }

  @Get(':source/history')
  async history(@Param('source') source: Source) {
    return this.sourceService.getTierSwitchHistory(source);
  }
}
