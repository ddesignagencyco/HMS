import { Global, Inject, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { EnvironmentService } from '../config/environment.service.js';

/** BE-017: adds the pool settings from the environment to a connection URL that does not already carry them. */
export const withPoolSettings = (url: string, poolMax: number, poolTimeoutS: number): string => {
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has('connection_limit')) parsed.searchParams.set('connection_limit', String(poolMax));
    if (!parsed.searchParams.has('pool_timeout')) parsed.searchParams.set('pool_timeout', String(poolTimeoutS));
    return parsed.toString();
  } catch {
    return url;
  }
};

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(EnvironmentService) environment: EnvironmentService) {
    super({ datasources: { db: { url: withPoolSettings(environment.values.DIRECT_URL, environment.values.DB_POOL_MAX, environment.values.DB_POOL_TIMEOUT_S) } }, log: ['warn', 'error'] });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async ping(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService]
})
export class PrismaModule {}
