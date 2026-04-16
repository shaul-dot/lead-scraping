import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  NotFoundException,
} from '@nestjs/common';
import { LeadsService, type LeadFilters } from './leads.service';
import { QueueService } from '../queues/queue.service';
import type { LeadInput } from '@hyperscale/types';

@Controller('leads')
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly queue: QueueService,
  ) {}

  @Get()
  async list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('source') source?: string,
    @Query('minScore') minScore?: string,
    @Query('maxScore') maxScore?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('search') search?: string,
  ) {
    const filters: LeadFilters = {
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      status,
      source,
      minScore: minScore ? parseInt(minScore, 10) : undefined,
      maxScore: maxScore ? parseInt(maxScore, 10) : undefined,
      dateFrom,
      dateTo,
      search,
    };
    return this.leads.findAll(filters);
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    try {
      return await this.leads.findById(id);
    } catch {
      throw new NotFoundException(`Lead ${id} not found`);
    }
  }

  @Get(':id/timeline')
  async timeline(@Param('id') id: string) {
    return this.leads.getTimeline(id);
  }

  @Post('import')
  async importCsv(@Body() body: { leads: LeadInput[] }) {
    return this.leads.bulkImport(body.leads);
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    return this.leads.updateStatus(id, body.status);
  }

  @Post(':id/rescore')
  async rescore(@Param('id') id: string) {
    const lead = await this.leads.findById(id);
    const jobId = await this.queue.addJob('score', {
      leads: [lead],
    });
    return { jobId, message: 'Rescore queued' };
  }

  @Post(':id/revalidate')
  async revalidate(@Param('id') id: string) {
    const lead = await this.leads.findById(id);
    const jobId = await this.queue.addJob('validate', {
      leads: [lead],
    });
    return { jobId, message: 'Revalidation queued' };
  }
}
