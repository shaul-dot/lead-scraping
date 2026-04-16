import { Injectable } from '@nestjs/common';
import {
  prisma,
  type Domain,
  type DomainHealthStatus,
  type DomainReputation,
} from '@hyperscale/database';
import { AlertService } from '../alert/alert.service';
import { createLogger } from '../common/logger';

const logger = createLogger('domain');

@Injectable()
export class DomainService {
  constructor(private readonly alertService: AlertService) {}

  async createDomain(data: {
    domain: string;
    provider?: string;
    redirectUrl?: string;
  }): Promise<Domain> {
    const domain = await prisma.domain.create({ data });
    logger.info({ domainId: domain.id, domain: data.domain }, 'Domain created');
    return domain;
  }

  async getDomains(filters?: { healthStatus?: string }) {
    const where = filters?.healthStatus
      ? { healthStatus: filters.healthStatus as DomainHealthStatus }
      : {};

    return prisma.domain.findMany({
      where,
      include: { _count: { select: { inboxes: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDomain(id: string) {
    return prisma.domain.findUniqueOrThrow({
      where: { id },
      include: { inboxes: true },
    });
  }

  async updateHealthStatus(
    domainId: string,
    status: DomainHealthStatus,
  ): Promise<Domain> {
    const domain = await prisma.domain.update({
      where: { id: domainId },
      data: { healthStatus: status },
    });

    if (status === 'BLACKLISTED' || status === 'BURNED') {
      await this.alertService.createAlert(
        'critical',
        'domain_health',
        `Domain ${domain.domain} is now ${status}`,
        `Health status changed to ${status}`,
        { domainId, domain: domain.domain, status },
      );
    }

    logger.info({ domainId, status }, 'Domain health status updated');
    return domain;
  }

  async updateDnsStatus(
    domainId: string,
    data: { dkimOk: boolean; spfOk: boolean; dmarcOk: boolean },
  ): Promise<Domain> {
    return prisma.domain.update({
      where: { id: domainId },
      data: { ...data, lastDnsCheck: new Date() },
    });
  }

  async updateBlacklistCounts(
    domainId: string,
    temp: number,
    perm: number,
  ): Promise<Domain> {
    const domain = await prisma.domain.update({
      where: { id: domainId },
      data: {
        blacklistTempCount: temp,
        blacklistPermCount: perm,
        lastBlacklistCheck: new Date(),
      },
    });

    if (perm > 0) {
      await this.alertService.createAlert(
        'warning',
        'domain_health',
        `Domain ${domain.domain} on ${perm} permanent blacklists`,
        `Temporary: ${temp}, Permanent: ${perm}`,
        { domainId, temp, perm },
      );
    }

    return domain;
  }

  async updateReputation(
    domainId: string,
    reputation: DomainReputation,
  ): Promise<Domain> {
    return prisma.domain.update({
      where: { id: domainId },
      data: { reputation, lastReputationCheck: new Date() },
    });
  }

  async getDomainsNeedingCheck(
    checkType: 'dns' | 'blacklist' | 'reputation',
    olderThanHours: number,
  ): Promise<Domain[]> {
    const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);

    const fieldMap = {
      dns: 'lastDnsCheck',
      blacklist: 'lastBlacklistCheck',
      reputation: 'lastReputationCheck',
    } as const;

    const field = fieldMap[checkType];

    return prisma.domain.findMany({
      where: {
        OR: [{ [field]: null }, { [field]: { lt: cutoff } }],
        healthStatus: { not: 'BURNED' },
      },
      orderBy: { [field]: { sort: 'asc', nulls: 'first' } },
    });
  }

  async getDomainsByStatus(status: DomainHealthStatus): Promise<Domain[]> {
    return prisma.domain.findMany({
      where: { healthStatus: status },
      include: { inboxes: true },
    });
  }
}
