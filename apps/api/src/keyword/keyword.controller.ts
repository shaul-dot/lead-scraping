import { Controller, Get, Post, Patch, Param, Body, Query } from '@nestjs/common';
import { KeywordService } from './keyword.service';
import type { Source } from '@hyperscale/types';

@Controller('keywords')
export class KeywordController {
  constructor(private readonly keywordService: KeywordService) {}

  @Get()
  async list(
    @Query('source') source?: Source,
    @Query('enabled') enabled?: string,
  ) {
    return this.keywordService.getKeywords({
      source,
      enabled: enabled != null ? enabled === 'true' : undefined,
    });
  }

  @Post()
  async create(
    @Body() body: { primary: string; source: Source; discoveredBy?: string },
  ) {
    return this.keywordService.addKeyword(
      body.primary,
      body.source,
      body.discoveredBy,
    );
  }

  @Patch(':id/toggle')
  async toggle(
    @Param('id') id: string,
    @Body() body: { enabled: boolean },
  ) {
    await this.keywordService.toggleKeyword(id, body.enabled);
    return { success: true };
  }

  @Post('recalc')
  async recalcAll() {
    await this.keywordService.recalcAllScores();
    return { success: true, message: 'Recalculation complete' };
  }
}
