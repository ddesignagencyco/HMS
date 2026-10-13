import { Global, Module } from '@nestjs/common';
import { EnvironmentService } from '../config/environment.service.js';
import { DevController } from './dev.controller.js';
import { DevInbox, MockEmailSender, MockGeocoder, MockObjectStorage, MockPaymentGateway, MockSmsSender, MockTelephony, MockWhatsAppSender } from './mocks.js';
import type { EmailSenderPort, GeocoderPort, ObjectStoragePort, PaymentGatewayPort, SmsSenderPort, TelephonyPort, WhatsAppSenderPort } from './ports.js';
import { SupabaseObjectStorage } from './supabase-storage.service.js';

export const PAYMENT_GATEWAY = 'PAYMENT_GATEWAY_PORT';
export const SMS_SENDER = 'SMS_SENDER_PORT';
export const EMAIL_SENDER = 'EMAIL_SENDER_PORT';
export const WHATSAPP_SENDER = 'WHATSAPP_SENDER_PORT';
export const GEOCODER = 'GEOCODER_PORT';
export const TELEPHONY = 'TELEPHONY_PORT';
export const OBJECT_STORAGE = 'OBJECT_STORAGE_PORT';

@Global()
@Module({
  controllers: [DevController],
  providers: [
    DevInbox,
    MockSmsSender,
    MockEmailSender,
    MockWhatsAppSender,
    MockGeocoder,
    MockTelephony,
    MockObjectStorage,
    SupabaseObjectStorage,
    MockPaymentGateway,
    { provide: SMS_SENDER, useExisting: MockSmsSender },
    { provide: EMAIL_SENDER, useExisting: MockEmailSender },
    { provide: WHATSAPP_SENDER, useExisting: MockWhatsAppSender },
    { provide: GEOCODER, useExisting: MockGeocoder },
    { provide: TELEPHONY, useExisting: MockTelephony },
    {
      provide: OBJECT_STORAGE,
      useFactory: (environment: EnvironmentService, mock: MockObjectStorage, supabase: SupabaseObjectStorage): ObjectStoragePort => {
        return environment.values.STORAGE_PROVIDER === 'supabase' ? supabase : mock;
      },
      inject: [EnvironmentService, MockObjectStorage, SupabaseObjectStorage]
    },
    { provide: PAYMENT_GATEWAY, useExisting: MockPaymentGateway }
  ],
  exports: [DevInbox, PAYMENT_GATEWAY, SMS_SENDER, EMAIL_SENDER, WHATSAPP_SENDER, GEOCODER, TELEPHONY, OBJECT_STORAGE, MockObjectStorage, SupabaseObjectStorage]
})
export class IntegrationsModule {}

export type IntegrationPorts = {
  payment: PaymentGatewayPort;
  sms: SmsSenderPort;
  email: EmailSenderPort;
  whatsapp: WhatsAppSenderPort;
  maps: GeocoderPort;
  telephony: TelephonyPort;
  storage: ObjectStoragePort;
};
