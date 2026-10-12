import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get('lat');
  const lng = searchParams.get('lng');
  const locale = searchParams.get('locale') || 'en';

  if (!lat || !lng) {
    return NextResponse.json({ error: 'Missing coordinates' }, { status: 400 });
  }

  // 1. Primary: Nominatim with server-side User-Agent
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1`,
      {
        signal: controller.signal,
        headers: {
          'User-Agent': 'SmartHome-PK/1.0 (support@smarthome.pk)',
          'Accept-Language': locale === 'ur' ? 'ur,en' : 'en',
        },
      }
    );
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      const addr = data.address || {};
      const road = addr.road || addr.pedestrian || addr.street || addr.footway || '';
      const houseNumber = addr.house_number || addr.house_name || '';
      const building = addr.building || addr.amenity || addr.commercial || addr.shop || '';
      const neighbourhood = addr.neighbourhood || addr.residential || addr.quarter || addr.block || '';
      const suburb = addr.suburb || addr.city_district || '';
      const displayName = data.display_name || '';

      return NextResponse.json({
        road,
        houseNumber,
        building,
        neighbourhood,
        suburb,
        displayName,
      });
    }
  } catch {
    // Continue to fallback
  }

  // 2. Fallback: Photon API
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(
      `https://photon.komoot.io/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`,
      { signal: controller.signal }
    );
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      const feature = data.features?.[0];
      const props = feature?.properties || {};

      return NextResponse.json({
        road: props.street || '',
        houseNumber: props.housenumber || '',
        building: props.name || '',
        neighbourhood: props.locality || '',
        suburb: props.district || '',
        displayName: [props.name, props.street, props.locality, props.district, props.city].filter(Boolean).join(', '),
      });
    }
  } catch {
    // Both attempts failed
  }

  return NextResponse.json({
    road: '',
    houseNumber: '',
    building: '',
    neighbourhood: '',
    suburb: '',
    displayName: '',
  });
}
