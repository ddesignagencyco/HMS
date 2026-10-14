import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderProfileScreen } from '@/features/provider/profile-view';
import { getDictionary } from '@/lib/dictionaries';
import type { Locale } from '@/lib/utils';

/* The professional's profile.

   Two contract facts this pins:

   · **The base location is part of this form.** `POST /provider/submit` refuses
     a profile without `city_id` and `base_location`, and `PATCH /provider/profile`
     is the only way to set them — `cityId`, `baseAddressText`, and `lat`+`lng`
     together.
   · **Empty text is omitted, not sent blank.** `profileUpdateSchema` is
     `.trim().min(1)` on `bio` and `qualification`, so `''` is a 422. */

const dict = getDictionary('en');
const locale: Locale = 'en';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const baseProfile = {
  userId: 'p1',
  status: 'PENDING_APPROVAL',
  bio: null,
  experienceYears: null,
  qualification: null,
  cityId: null,
  baseAddressText: null,
  lat: null,
  lng: null,
  radiusM: 8000
};

let profile: Record<string, unknown> = { ...baseProfile };

const renderScreen = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } } });
  const Component = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<ProviderProfileScreen locale={locale} dict={dict} />, { wrapper: Component });
};

const patches = () =>
  (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([url, init]) => String(url).includes('/provider/profile') && (init as RequestInit | undefined)?.method === 'PATCH');

const patchBody = (index = 0) => JSON.parse(String((patches()[index][1] as RequestInit).body)) as Record<string, unknown>;

beforeEach(() => {
  profile = { ...baseProfile };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'PATCH' && url.includes('/provider/profile')) return json(profile);
      if (url.includes('/provider/profile')) return json(profile);
      if (url.includes('/provider/service-areas')) return json({ items: [] });
      if (url.includes('/places/cities/1/areas'))
        return json({
          items: [
            { id: 11, cityId: 1, name: 'Gulberg III', lat: 31.5204, lng: 74.3587 },
            { id: 12, cityId: 1, name: 'Unsurveyed', lat: null, lng: null }
          ]
        });
      if (url.includes('/places/cities')) return json({ items: [{ id: 1, name: 'Lahore', timezone: 'Asia/Karachi', lat: 31.5, lng: 74.3 }] });
      throw new Error(`unrouted ${method} ${url}`);
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('provider profile', () => {
  it('says the base location is not set yet', async () => {
    renderScreen();
    expect(await screen.findByText(dict.portal.baseLocationNotSet)).toBeDefined();
  });

  it('shows the saved city and address', async () => {
    profile = { ...baseProfile, cityId: 1, baseAddressText: 'Main Boulevard', lat: 31.52, lng: 74.35 };
    renderScreen();
    expect(await screen.findByText('Lahore · Main Boulevard')).toBeDefined();
  });

  it('sends city, address and the chosen area centroid as the base point', async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: dict.portal.editProfile }));

    fireEvent.mouseDown(await screen.findByLabelText(dict.portal.cityLabel));
    fireEvent.click(await screen.findByText('Lahore'));
    await waitFor(() => expect((screen.getByLabelText(dict.portal.areaLabel) as HTMLInputElement).disabled).toBe(false));
    fireEvent.mouseDown(screen.getByLabelText(dict.portal.areaLabel));
    fireEvent.click(await screen.findByText('Gulberg III'));
    expect(await screen.findByText(dict.portal.locationFromArea)).toBeDefined();
    fireEvent.change(screen.getByLabelText(dict.portal.baseAddressLabel), { target: { value: '  12 Main Boulevard ' } });

    fireEvent.click(screen.getByRole('button', { name: dict.portal.save }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    /* No bio or qualification keys: both were blank, and blank is a 422. */
    expect(patchBody()).toEqual({ radiusM: 8000, cityId: 1, baseAddressText: '12 Main Boulevard', lat: 31.5204, lng: 74.3587 });
  });

  it('uses the device position when the professional asks for it', async () => {
    const getCurrentPosition = vi.fn((ok: PositionCallback) => ok({ coords: { latitude: 31.4, longitude: 74.2 } } as GeolocationPosition));
    vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } });
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: dict.portal.editProfile }));
    fireEvent.mouseDown(await screen.findByLabelText(dict.portal.cityLabel));
    fireEvent.click(await screen.findByText('Lahore'));
    fireEvent.click(screen.getByRole('button', { name: dict.portal.useMyLocation }));
    expect(await screen.findByText(dict.portal.locationFromDevice)).toBeDefined();
    fireEvent.change(screen.getByLabelText(dict.portal.baseAddressLabel), { target: { value: 'House 4' } });
    fireEvent.click(screen.getByRole('button', { name: dict.portal.save }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patchBody()).toMatchObject({ cityId: 1, baseAddressText: 'House 4', lat: 31.4, lng: 74.2 });
  });

  it('keeps the area option when the device location is refused', async () => {
    const getCurrentPosition = vi.fn((_ok: PositionCallback, fail: PositionErrorCallback) => fail({ code: 1, message: 'denied' } as GeolocationPositionError));
    vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } });
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: dict.portal.editProfile }));
    fireEvent.click(await screen.findByRole('button', { name: dict.portal.useMyLocation }));
    expect(await screen.findByText(dict.portal.locationDenied)).toBeDefined();
    expect(screen.getByLabelText(dict.portal.areaLabel)).toBeDefined();
  });

  it('refuses a half-set base location before sending it', async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: dict.portal.editProfile }));
    fireEvent.mouseDown(await screen.findByLabelText(dict.portal.cityLabel));
    fireEvent.click(await screen.findByText('Lahore'));
    fireEvent.click(screen.getByRole('button', { name: dict.portal.save }));
    expect(await screen.findByText(dict.portal.baseLocationIncomplete)).toBeDefined();
    expect(patches()).toHaveLength(0);
  });

  it('sends trimmed bio and qualification, and nothing about the base when it is untouched', async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: dict.portal.editProfile }));
    fireEvent.change(await screen.findByLabelText(dict.providers.qualification), { target: { value: ' Licensed electrician ' } });
    fireEvent.click(screen.getByRole('button', { name: dict.portal.save }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patchBody()).toEqual({ qualification: 'Licensed electrician', radiusM: 8000 });
  });
});
