import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { DomainError } from '../common/domain-error.js';
import { Public } from '../common/policy.js';
import { parseWith } from '../common/validation.js';
import { EnvironmentService } from '../config/environment.service.js';
import { DevInbox, MockObjectStorage, STORAGE_BUCKETS } from './mocks.js';

const bucketSchema = z.enum(STORAGE_BUCKETS);
const listQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).strict();
/** The policy the presign step decided, carried on the URL itself. */
const storagePutQuerySchema = z
  .object({
    contentType: z.string().trim().min(1).max(120),
    maxBytes: z.coerce
      .number()
      .int()
      .min(1)
      .max(8 * 1024 * 1024)
  })
  .strict();

@ApiTags('development')
@Controller('dev')
export class DevController {
  constructor(
    @Inject(EnvironmentService) private readonly environment: EnvironmentService,
    @Inject(DevInbox) private readonly inbox: DevInbox,
    @Inject(MockObjectStorage) private readonly storage: MockObjectStorage
  ) {}

  @Get('inbox')
  @Public()
  @ApiOperation({
    summary: 'View messages the mock SMS/email/WhatsApp senders "sent"',
    description:
      'Development-only: since no real SMS/email/WhatsApp provider is configured, messages that would normally be delivered are captured here instead — including OTP codes — so you can complete a signup or login flow while testing locally. Disabled when DEV_INBOX_ENABLED is false.'
  })
  inboxMessages(@Query() query: unknown) {
    this.assertEnabled();
    const { limit } = parseWith(listQuerySchema, query);
    return { items: this.inbox.list(limit) };
  }

  @Get('storage/:bucket/:key')
  @Public()
  @ApiOperation({
    summary: 'Download a file from the mock file storage',
    description: "Development-only: retrieves a file that was 'uploaded' to the mock storage adapter, which stands in for a real object store (like S3 or MinIO) in this environment."
  })
  storageObject(@Param('bucket') bucket: string, @Param('key') key: string) {
    this.assertEnabled();
    const parsedBucket = parseWith(bucketSchema, bucket);
    const object = this.storage.read(parsedBucket, decodeURIComponent(key));
    if (object === null) throw new DomainError('NOT_FOUND', 'The object does not exist in the mock storage adapter');
    return { bucket: parsedBucket, key: decodeURIComponent(key), contentType: object.contentType, sizeBytes: object.content.byteLength, contentBase64: Buffer.from(object.content).toString('base64') };
  }

  /**
   * The other half of `presignPut`: the mock adapter hands out a URL to PUT the
   * bytes to, so the verb has to exist or every presigned upload is a guaranteed
   * 404 the moment the browser sends the file. Same key, same bucket, retrieved
   * again through the GET above.
   *
   * `contentType` and `maxBytes` come from the presigned URL rather than the
   * request, so a client cannot widen the policy the presign step decided on.
   */
  @Put('storage/:bucket/:key')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Upload a file to the mock file storage',
    description:
      'Development-only: the PUT target of a presigned upload URL from POST /uploads/presign. Stores the bytes in memory under bucket/key, where GET /dev/storage/{bucket}/{key} can read them back.'
  })
  async uploadObject(
    @Param('bucket') bucket: string,
    @Param('key') key: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @Headers('content-type') requestContentType: string | undefined
  ): Promise<{ bucket: string; key: string; contentType: string; sizeBytes: number }> {
    this.assertEnabled();
    const parsedBucket = parseWith(bucketSchema, bucket);
    const { contentType, maxBytes } = parseWith(storagePutQuerySchema, query);
    const content = Buffer.isBuffer(body) ? new Uint8Array(body) : null;
    if (content === null) throw new DomainError('BAD_REQUEST', 'The upload must be sent as raw bytes, not as a JSON body');
    if (content.byteLength === 0) throw new DomainError('BAD_REQUEST', 'The upload was empty');
    if (content.byteLength > maxBytes) throw new DomainError('BAD_REQUEST', `The upload is larger than the ${maxBytes} bytes the presigned URL allows`);
    const decodedKey = decodeURIComponent(key);
    await this.storage.put({ bucket: parsedBucket, key: decodedKey, content, contentType: requestContentType ?? contentType });
    return { bucket: parsedBucket, key: decodedKey, contentType: requestContentType ?? contentType, sizeBytes: content.byteLength };
  }

  private assertEnabled(): void {
    if (!this.environment.values.DEV_INBOX_ENABLED) throw new DomainError('FORBIDDEN', 'Development endpoints are disabled in this environment');
  }
}
