import { describe, expect, it } from 'vitest';
import { MASK_EMAIL, MASK_PHONE, maskContactDetails } from '../src/booking/message-masking.js';

describe('FR-BK-07: contact details are masked before a chat message is stored', () => {
  it.each([
    ['call me on 03001234567 please', `call me on ${MASK_PHONE} please`],
    ['+92 300 1234567', MASK_PHONE],
    ['my number is 0300-123-4567.', `my number is ${MASK_PHONE}.`],
    ['(0300) 123 4567', MASK_PHONE],
    ['whatsapp +923001234567 now', `whatsapp ${MASK_PHONE} now`],
    ['zero three zero zero one two three four five six seven', MASK_PHONE],
    // Ways of writing the same number that used to sail straight through the filter, so the digits
    // reached the database and the other party unmasked.
    ['call 0300/1234567 now', `call ${MASK_PHONE} now`],
    ['call 0300_1234567', `call ${MASK_PHONE}`],
    ['ring 0300,1234567', `ring ${MASK_PHONE}`],
    ['wa.me/923001234567', `wa.me/${MASK_PHONE}`]
  ])('masks the phone number in %j', (input, expected) => {
    const result = maskContactDetails(input);
    expect(result.body).toBe(expected);
    expect(result.masked).toBe(true);
  });

  it.each([
    ['write to ali.khan+jobs@example.com today', `write to ${MASK_EMAIL} today`],
    ['ali @ example . com', MASK_EMAIL]
  ])('masks the email address in %j', (input, expected) => {
    expect(maskContactDetails(input).body).toBe(expected);
  });

  it('leaves ordinary numbers alone: prices, house numbers, times', () => {
    for (const harmless of ['The job is 5000 rupees', 'I am at house 1234, street 7', 'see you at 10:30', 'floor 3, flat 12', 'Order 2026 10 12']) {
      const result = maskContactDetails(harmless);
      expect(result.body).toBe(harmless);
      expect(result.masked).toBe(false);
    }
  });

  it('still leaves a thousands-separated price alone, which is what the widened separator set had to avoid', () => {
    // The filter now treats `,` and `/` as separators, so the thing that could break is a long
    // grouped number being read as a phone number. "Rs 1,250,000" is 7 digits and stays; a genuinely
    // 9+ digit run of digits and separators is masked either way, which is the correct trade.
    for (const harmless of ['Rs 1,250,000 total', 'the bill came to 250,000 rupees', 'ref 12/05/2026']) {
      expect(maskContactDetails(harmless).body).toBe(harmless);
    }
  });

  it('masks several details in one message and reports it', () => {
    const result = maskContactDetails('a@b.co or 03001234567');
    expect(result.body).toBe(`${MASK_EMAIL} or ${MASK_PHONE}`);
    expect(result.masked).toBe(true);
  });
});
