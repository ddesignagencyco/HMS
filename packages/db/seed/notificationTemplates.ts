import { execute, literal } from './support.js';

type TemplateSeed = { eventKey: string; channel: 'SMS' | 'EMAIL' | 'IN_APP' | 'WHATSAPP'; subject: string | null; bodyEn: string; bodyUr: string };

const t = (eventKey: string, channel: TemplateSeed['channel'], subject: string | null, bodyEn: string, bodyUr: string): TemplateSeed => ({ eventKey, channel, subject, bodyEn, bodyUr });

export const notificationTemplates: readonly TemplateSeed[] = [
  t('auth.otp', 'SMS', null, 'Your Smart Home verification code is {{code}}. It expires in 10 minutes.', 'آپ کا سمارٹ ہوم کوڈ {{code}} ہے۔ یہ 10 منٹ میں ختم ہو جائے گا۔'),
  t('auth.password_reset', 'SMS', null, 'Use code {{code}} to reset your Smart Home password.', 'پاس ورڈ ری سیٹ کرنے کے لیے کوڈ {{code}} استعمال کریں۔'),
  t('booking.requested', 'IN_APP', 'Booking request received', 'We are finding a {{serviceName}} professional near you.', 'ہم آپ کے قریب {{serviceName}} کا پیشہ کار تلاش کر رہے ہیں۔'),
  t('booking.offer', 'SMS', null, 'A {{serviceName}} job is available near you on {{slotLabel}}. Open the app to accept.', '{{slotLabel}} پر {{serviceName}} کا کام دستیاب ہے۔ قبول کرنے کے لیے ایپ کھولیں۔'),
  t('booking.accepted', 'IN_APP', 'Provider assigned', '{{providerName}} is assigned to your booking.', '{{providerName}} آپ کے بکنگ کے لیے منتخب ہو گیا ہے۔'),
  t('booking.scheduled', 'SMS', null, 'Your visit is confirmed for {{slotLabel}}. Your start code is {{otp}}.', 'آپ کا وزٹ {{slotLabel}} کو confirm ہے۔ آپ کا کوڈ {{otp}} ہے۔'),
  t('booking.confirmed', 'SMS', null, 'Your {{serviceName}} visit is confirmed for {{slotLabel}}. Your provider is {{providerName}}.', 'آپ کا {{serviceName}} وزٹ {{slotLabel}} کو confirm ہے۔ آپ کا پیشہ کار {{providerName}} ہے۔'),
  t('booking.on_the_way', 'SMS', null, '{{providerName}} is on the way to your address for {{serviceName}}.', '{{providerName}} آپ کے پتے پر {{serviceName}} کے لیے روانہ ہو گیا ہے۔'),
  t('booking.unfulfilled', 'IN_APP', 'No provider available', 'We could not find a provider for booking {{bookingRef}}. Any payment is being refunded.', 'ہمیں بکنگ {{bookingRef}} کے لیے پیشہ کار نہیں ملا۔ ادا شدہ رقم واپس کی جا رہی ہے۔'),
  t('booking.message', 'IN_APP', 'New message', 'You have a new message about booking {{bookingRef}}.', 'بکنگ {{bookingRef}} کے بارے میں آپ کے لیے نیا پیغام ہے۔'),
  t('complaint.response_requested', 'IN_APP', 'Your response is needed', 'A complaint ({{complaintRef}}) needs your response. Please reply so it can be decided fairly.', 'ایک شکایت ({{complaintRef}}) پر آپ کا جواب درکار ہے۔ براہ کرم جواب دیں۔'),
  t('complaint.response_requested', 'SMS', null, 'Smart Home: a complaint ({{complaintRef}}) needs your response. Open the app to reply.', 'سمارٹ ہوم: شکایت ({{complaintRef}}) پر آپ کا جواب درکار ہے۔ ایپ کھول کر جواب دیں۔'),
  t('complaint.status_changed', 'IN_APP', 'Complaint updated', 'Complaint {{complaintRef}} is now {{to}}.', 'شکایت {{complaintRef}} اب {{to}} ہے۔'),
  t('complaint.warning', 'IN_APP', 'Warning', 'A complaint ({{complaintRef}}) was decided with a warning. Please review our conduct guidelines.', 'شکایت ({{complaintRef}}) پر تنبیہ جاری کی گئی ہے۔ براہ کرم ہمارے رہنما اصول دیکھیں۔'),
  t('admin.safety_complaint', 'IN_APP', 'Safety complaint', 'URGENT: a safety complaint ({{complaintRef}}) was raised for booking {{bookingRef}}. One-hour SLA.', 'فوری: بکنگ {{bookingRef}} پر حفاظتی شکایت ({{complaintRef}}) درج ہوئی ہے۔ ایک گھنٹے کی حد۔'),
  t('admin.safety_complaint', 'SMS', null, 'URGENT Smart Home: safety complaint {{complaintRef}} raised. Open the admin console now.', 'فوری سمارٹ ہوم: حفاظتی شکایت {{complaintRef}} درج ہوئی۔ ابھی ایڈمن کنسول کھولیں۔'),
  t('admin.complaint_sla_breach', 'IN_APP', 'Complaint SLA breached', 'Complaint {{complaintRef}} has passed its SLA without being decided.', 'شکایت {{complaintRef}} مقررہ وقت میں حل نہیں ہوئی۔'),
  t('admin.verification_sla_breach', 'IN_APP', 'Verification SLA breached', 'A verification call missed its SLA (booking {{bookingRef}}).', 'ایک تصدیقی کال مقررہ وقت میں نہیں ہوئی (بکنگ {{bookingRef}})۔'),
  t('admin.dispute_opened', 'IN_APP', 'Dispute opened', 'A dispute was opened on booking {{bookingRef}}; its money is frozen.', 'بکنگ {{bookingRef}} پر تنازع کھلا؛ رقم منجمد ہے۔'),
  t('admin.provider_pending', 'IN_APP', 'Provider awaiting approval', 'A new provider is waiting for approval.', 'ایک نیا پروائیڈر منظوری کا منتظر ہے۔'),
  t('admin.appeal_filed', 'IN_APP', 'Appeal filed', 'A provider appealed penalty {{penaltyId}}.', 'ایک پروائیڈر نے جرمانہ {{penaltyId}} کے خلاف اپیل کی ہے۔'),
  t('dispute.opened', 'IN_APP', 'Dispute on your job', 'A dispute was opened on booking {{bookingRef}}. Please review the evidence and reply.', 'بکنگ {{bookingRef}} پر تنازع کھلا ہے۔ ثبوت دیکھ کر جواب دیں۔'),
  t('dispute.opened', 'SMS', null, 'Smart Home: a dispute was opened on booking {{bookingRef}}. Please reply in the app.', 'سمارٹ ہوم: بکنگ {{bookingRef}} پر تنازع کھلا۔ ایپ میں جواب دیں۔'),
  t('dispute.resolved', 'IN_APP', 'Dispute decided', 'The dispute on booking {{bookingRef}} was decided: {{resolution}}.', 'بکنگ {{bookingRef}} کے تنازع کا فیصلہ ہو گیا: {{resolution}}۔'),
  t('dispute.resolved', 'SMS', null, 'Smart Home: the dispute on booking {{bookingRef}} was decided ({{resolution}}). See the app for details.', 'سمارٹ ہوم: بکنگ {{bookingRef}} کے تنازع کا فیصلہ ({{resolution}}) ہو گیا۔'),
  t('penalty.proposed', 'SMS', null, 'Smart Home: a penalty was proposed against your account. You have until {{replyDueAt}} to reply in the app.', 'سمارٹ ہوم: آپ کے اکاؤنٹ پر جرمانہ تجویز ہوا ہے۔ {{replyDueAt}} تک ایپ میں جواب دیں۔'),
  t('penalty.applied', 'IN_APP', 'Penalty applied', 'A penalty ({{breachCode}}) was applied. Active points: {{pointsAfter}}. You may appeal in the app.', 'جرمانہ ({{breachCode}}) نافذ ہوا۔ فعال پوائنٹس: {{pointsAfter}}۔ آپ ایپ میں اپیل کر سکتے ہیں۔'),
  t('penalty.applied', 'SMS', null, 'Smart Home: a penalty was applied to your account. Open the app for details and to appeal.', 'سمارٹ ہوم: آپ کے اکاؤنٹ پر جرمانہ نافذ ہوا۔ تفصیل اور اپیل کے لیے ایپ کھولیں۔'),
  t('appeal.decided', 'IN_APP', 'Appeal decided', 'Your appeal was decided: {{decision}}.', 'آپ کی اپیل کا فیصلہ ہو گیا: {{decision}}۔'),
  t('appeal.decided', 'SMS', null, 'Smart Home: your appeal was decided ({{decision}}). See the app for details.', 'سمارٹ ہوم: آپ کی اپیل کا فیصلہ ({{decision}}) ہو گیا۔'),
  t('provider.warned', 'IN_APP', 'Written warning', 'Your conduct record has reached the warning level. Please review the conduct guidelines.', 'آپ کا ریکارڈ تنبیہ کی سطح تک پہنچ گیا ہے۔ رہنما اصول دیکھیں۔'),
  t('provider.suspended', 'IN_APP', 'Account suspended', 'Your account is suspended until {{until}}. You will not receive new jobs during this time.', 'آپ کا اکاؤنٹ {{until}} تک معطل ہے۔ اس دوران نئے کام نہیں ملیں گے۔'),
  t('provider.suspended', 'SMS', null, 'Smart Home: your account is suspended until {{until}}. Open the app for details.', 'سمارٹ ہوم: آپ کا اکاؤنٹ {{until}} تک معطل ہے۔ تفصیل ایپ میں دیکھیں۔'),
  t('provider.blocked', 'IN_APP', 'Account blocked', 'Your account has been blocked. Contact support if you believe this is a mistake.', 'آپ کا اکاؤنٹ بلاک کر دیا گیا ہے۔ غلطی کی صورت میں سپورٹ سے رابطہ کریں۔'),
  t('provider.blocked', 'SMS', null, 'Smart Home: your account has been blocked. Contact support for details.', 'سمارٹ ہوم: آپ کا اکاؤنٹ بلاک کر دیا گیا ہے۔ تفصیل کے لیے سپورٹ سے رابطہ کریں۔'),
  t('payment.released_provider', 'IN_APP', 'Payment released to you', '{{amount}} for booking {{bookingRef}} was released to your wallet.', 'بکنگ {{bookingRef}} کی {{amount}} آپ کے والٹ میں جاری کر دی گئی۔'),
  t('booking.cash_authorised', 'IN_APP', 'You may collect payment', 'Booking {{bookingRef}} is verified. You may collect the cash; confirm in the app once you have.', 'بکنگ {{bookingRef}} کی تصدیق ہو گئی۔ آپ رقم وصول کر سکتے ہیں؛ وصولی کے بعد ایپ میں تصدیق کریں۔'),
  t('payment.debt_paid', 'IN_APP', 'Commission debt payment received', 'Your commission debt payment of {{amountPaisa}} paisa was received.', 'آپ کی کمیشن ادائیگی وصول ہو گئی۔'),
  t('booking.reminder_24h', 'SMS', null, 'Reminder: your {{serviceName}} visit is tomorrow at {{slotLabel}}.', 'یاد دہانی: آپ کا {{serviceName}} وزٹ کل {{slotLabel}} کو ہے۔'),
  t('booking.reminder_2h', 'SMS', null, 'Your {{serviceName}} professional arrives in about 2 hours.', 'آپ کے {{serviceName}} پیشہ کار تقریباً 2 گھنٹے میں پہنچیں گے۔'),
  t('booking.cancelled', 'IN_APP', 'Booking cancelled', 'Your booking {{bookingRef}} was cancelled. Any paid amount is being refunded.', 'آپ کا بکنگ {{bookingRef}} منسوخ ہو گیا۔ ادا شدہ رقم واپس کی جا رہی ہے۔'),
  t('booking.on_the_way', 'IN_APP', 'Provider on the way', '{{providerName}} has left for your address.', '{{providerName}} آپ کے پتے کے لیے روانہ ہو گیا ہے۔'),
  t('booking.quote_revision', 'IN_APP', 'Revised quote awaiting approval', '{{providerName}} submitted a revised total of {{total}}. Please approve or reject.', '{{providerName}} نے نیا رقم {{total}} بھیجا ہے۔ منظور یا مسترد کریں۔'),
  t('booking.awaiting_verification', 'IN_APP', 'Work completed', 'Your job is complete and payment is being verified.', 'آپ کا کام مکمل ہے اور ادائیگی کی تصدیق جاری ہے۔'),
  t('booking.no_show_reported', 'IN_APP', 'No-show reported', 'A no-show was recorded for booking {{bookingRef}}.', 'بکنگ {{bookingRef}} کے لیے حاضری نہیں کی گئی۔'),
  t('verification.link', 'SMS', null, 'Confirm your booking {{bookingRef}} at {{link}} using code {{otp}}.', 'کوڈ {{otp}} استعمال کر کے {{link}} پر بکنگ {{bookingRef}} کی تصدیق کریں۔'),
  t('payment.released', 'IN_APP', 'Payment released', '{{amount}} has been released to your provider.', '{{amount}} آپ کے پیشہ کار کو جاری کر دی گئی ہے۔'),
  t('payment.receipt', 'SMS', null, 'Receipt for {{amount}} on booking {{bookingRef}}. Report a problem: {{problemLink}}', 'بکنگ {{bookingRef}} پر {{amount}} کی رسید۔ مسئلہ رپورٹ کریں: {{problemLink}}'),
  t('payment.refunded', 'IN_APP', 'Refund processed', '{{amount}} was refunded to your original payment method.', '{{amount}} آپ کے ادائیگی طریقے پر واپس کر دی گئی ہے۔'),
  t('complaint.received', 'IN_APP', 'Complaint received', 'We received your complaint about booking {{bookingRef}} and will respond within the stated time.', 'ہمیں آپ کی شکایت مل گئی ہے اور ہم مقررہ وقت میں جواب دیں گے۔'),
  t('penalty.proposed', 'IN_APP', 'Penalty proposed', 'A breach was recorded against your account. You have 48 hours to reply.', 'آپ کے اکاؤنٹ پر جرم درج ہوا ہے۔ جواب دینے کے لیے 48 گھنٹے ہیں۔'),
  t('payout.paid', 'IN_APP', 'Payout paid', '{{amount}} was paid to your bank account.', '{{amount}} آپ کے بینک اکاؤنٹ میں جمع کر دی گئی۔')
];

export const seedNotificationTemplates = async (): Promise<void> => {
  for (const template of notificationTemplates) {
    for (const [locale, body] of [
      ['en', template.bodyEn],
      ['ur', template.bodyUr]
    ] as const) {
      await execute(
        `INSERT INTO notification_templates(event_key, channel, locale, subject, body)
         VALUES (${literal(template.eventKey)}, ${literal(template.channel)}::notification_channel, ${literal(locale)},
           ${template.subject === null ? 'NULL' : literal(template.subject)}, ${literal(body)})
         ON CONFLICT (event_key, channel, locale) DO UPDATE SET subject = EXCLUDED.subject, body = EXCLUDED.body`
      );
    }
  }
};
