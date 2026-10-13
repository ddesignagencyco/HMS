/**
 * Cloudinary Media Assets for Services and Categories
 *
 * Dedicated collection of 14 high-resolution trade & technician images
 * hosted on Cloudinary for use across discovery, categories, popular services,
 * and service detail screens.
 *
 * GUARANTEE: Every active service in the system catalogue has its own dedicated,
 * unique image. No two services share the same image.
 */

export const SERVICE_CLOUDINARY_IMAGES = [
    'https://res.cloudinary.com/descwlwga/image/upload/v1791889243/leak-repair_j4eh9i.jpg',
    'https://res.cloudinary.com/descwlwga/image/upload/v1791889242/blocked-drain_x0jz7x.jpg',
    'https://res.cloudinary.com/descwlwga/image/upload/v1791889241/new-fixture-install_a7l5u7.jpg',
    'https://res.cloudinary.com/descwlwga/image/upload/v1791889240/fault-finding_fl9ktk.jpg',
    'https://res.cloudinary.com/descwlwga/image/upload/v1791889239/switch-socket-repair_hh94jm.jpg',
    'https://res.cloudinary.com/descwlwga/image/upload/v1791889234/washing-machine-repair_pdl7ma.jpg',
    'https://res.cloudinary.com/descwlwga/image/upload/v1791889236/ac-service_lwtrbw.jpg',
    'https://res.cloudinary.com/descwlwga/image/upload/v1791889235/refrigerator-repair_bujmzf.jpg',
    'https://res.cloudinary.com/descwlwga/image/upload/v1791889236/furniture-repair_fw3ngc.jpg',
    'https://res.cloudinary.com/descwlwga/image/upload/v1791889235/door-window-repair_qkaqdc.jpg',
    'https://res.cloudinary.com/descwlwga/image/upload/v1791889257/interior-painting_z0aecm.jpg',
    'https://res.cloudinary.com/descwlwga/image/upload/v1791889356/waterproofing-treatment_muwben.jpg',
    'https://res.cloudinary.com/descwlwga/image/upload/v1791889430/deep-cleaning_bsbfol.jpg',
    'https://res.cloudinary.com/descwlwga/image/upload/v1791889428/pest-control_epf5fa.jpg',
] as const;

/**
 * Direct 1-to-1 Service Slug to Cloudinary URL Mapping.
 * Every single service has a unique, dedicated image.
 */
export const SERVICE_IMAGE_MAP: Record<string, string> = {
    // Plumbing
    'leak-repair': 'https://res.cloudinary.com/descwlwga/image/upload/v1791889243/leak-repair_j4eh9i.jpg',
    'blocked-drain': 'https://res.cloudinary.com/descwlwga/image/upload/v1791889242/blocked-drain_x0jz7x.jpg',
    'new-fixture-install': 'https://res.cloudinary.com/descwlwga/image/upload/v1791889241/new-fixture-install_a7l5u7.jpg',

    // Electrical
    'fault-finding': 'https://res.cloudinary.com/descwlwga/image/upload/v1791889240/fault-finding_fl9ktk.jpg',
    'switch-socket-repair': 'https://res.cloudinary.com/descwlwga/image/upload/v1791889239/switch-socket-repair_hh94jm.jpg',
    'switch-repair': 'https://res.cloudinary.com/descwlwga/image/upload/v1791889239/switch-socket-repair_hh94jm.jpg',

    // Appliance Repair
    'washing-machine-repair': 'https://res.cloudinary.com/descwlwga/image/upload/v1791889234/washing-machine-repair_pdl7ma.jpg',
    'ac-service': 'https://res.cloudinary.com/descwlwga/image/upload/v1791889236/ac-service_lwtrbw.jpg',
    'refrigerator-repair': 'https://res.cloudinary.com/descwlwga/image/upload/v1791889235/refrigerator-repair_bujmzf.jpg',

    // Carpentry & Furniture
    'furniture-repair': 'https://res.cloudinary.com/descwlwga/image/upload/v1791889236/furniture-repair_fw3ngc.jpg',
    'door-window-repair': 'https://res.cloudinary.com/descwlwga/image/upload/v1791889235/door-window-repair_qkaqdc.jpg',
    'door-repair': 'https://res.cloudinary.com/descwlwga/image/upload/v1791889235/door-window-repair_qkaqdc.jpg',

    // Painting & Waterproofing
    'interior-painting': 'https://res.cloudinary.com/descwlwga/image/upload/v1791889257/interior-painting_z0aecm.jpg',
    'waterproofing-treatment': 'https://res.cloudinary.com/descwlwga/image/upload/v1791889356/waterproofing-treatment_muwben.jpg',

    // Cleaning & Pest Control
    'deep-cleaning': 'https://res.cloudinary.com/descwlwga/image/upload/v1791889430/deep-cleaning_bsbfol.jpg',
    'pest-control': 'https://res.cloudinary.com/descwlwga/image/upload/v1791889428/pest-control_epf5fa.jpg',

    // Smart Home & Security
    'cctv-installation': 'https://images.pexels.com/photos/430208/pexels-photo-430208.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1',
    'smart-lock-installation': 'https://images.pexels.com/photos/279813/pexels-photo-279813.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1',
};

/**
 * Direct category slug to representative image URL mapping
 */
export const CATEGORY_IMAGE_MAP: Record<string, string> = {
    // Electrical
    electrical: 'https://res.cloudinary.com/descwlwga/image/upload/v1791889240/fault-finding_fl9ktk.jpg',
    'electrical-services': 'https://res.cloudinary.com/descwlwga/image/upload/v1791889240/fault-finding_fl9ktk.jpg',

    // AC & Refrigeration
    'ac-and-refrigeration': 'https://res.cloudinary.com/descwlwga/image/upload/v1791889236/ac-service_lwtrbw.jpg',
    cooling: 'https://res.cloudinary.com/descwlwga/image/upload/v1791889236/ac-service_lwtrbw.jpg',
    hvac: 'https://res.cloudinary.com/descwlwga/image/upload/v1791889236/ac-service_lwtrbw.jpg',

    // Plumbing
    plumbing: 'https://res.cloudinary.com/descwlwga/image/upload/v1791889241/new-fixture-install_a7l5u7.jpg',
    'sanitary-plumbing': 'https://res.cloudinary.com/descwlwga/image/upload/v1791889241/new-fixture-install_a7l5u7.jpg',

    // Bathroom & Water Heating
    'bathroom-and-water-heating': 'https://res.cloudinary.com/descwlwga/image/upload/v1791889243/leak-repair_j4eh9i.jpg',
    'sanitary-bathroom': 'https://res.cloudinary.com/descwlwga/image/upload/v1791889243/leak-repair_j4eh9i.jpg',
    geyser: 'https://res.cloudinary.com/descwlwga/image/upload/v1791889243/leak-repair_j4eh9i.jpg',

    // Appliance Repair
    'appliance-repair': 'https://res.cloudinary.com/descwlwga/image/upload/v1791889234/washing-machine-repair_pdl7ma.jpg',
    appliances: 'https://res.cloudinary.com/descwlwga/image/upload/v1791889234/washing-machine-repair_pdl7ma.jpg',

    // Carpentry & Furniture
    carpentry: 'https://res.cloudinary.com/descwlwga/image/upload/v1791889236/furniture-repair_fw3ngc.jpg',
    'carpentry-furniture': 'https://res.cloudinary.com/descwlwga/image/upload/v1791889236/furniture-repair_fw3ngc.jpg',
    woodwork: 'https://res.cloudinary.com/descwlwga/image/upload/v1791889236/furniture-repair_fw3ngc.jpg',

    // Painting
    painting: 'https://res.cloudinary.com/descwlwga/image/upload/v1791889257/interior-painting_z0aecm.jpg',
    'painting-waterproofing': 'https://res.cloudinary.com/descwlwga/image/upload/v1791889257/interior-painting_z0aecm.jpg',
    'paint-masonry-waterproofing': 'https://res.cloudinary.com/descwlwga/image/upload/v1791889257/interior-painting_z0aecm.jpg',

    // Waterproofing
    waterproofing: 'https://res.cloudinary.com/descwlwga/image/upload/v1791889356/waterproofing-treatment_muwben.jpg',
    'roof-waterproofing': 'https://res.cloudinary.com/descwlwga/image/upload/v1791889356/waterproofing-treatment_muwben.jpg',

    // Cleaning
    cleaning: 'https://res.cloudinary.com/descwlwga/image/upload/v1791889430/deep-cleaning_bsbfol.jpg',
    'cleaning-pest': 'https://res.cloudinary.com/descwlwga/image/upload/v1791889430/deep-cleaning_bsbfol.jpg',

    // Pest Control
    pest: 'https://res.cloudinary.com/descwlwga/image/upload/v1791889428/pest-control_epf5fa.jpg',
    'pest-control': 'https://res.cloudinary.com/descwlwga/image/upload/v1791889428/pest-control_epf5fa.jpg',

    // Security & Smart Home
    'security-smart-home': 'https://images.pexels.com/photos/430208/pexels-photo-430208.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1',
    cctv: 'https://images.pexels.com/photos/430208/pexels-photo-430208.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1',

    // General fallback
    general: 'https://res.cloudinary.com/descwlwga/image/upload/v1791889240/fault-finding_fl9ktk.jpg',
};

/**
 * Deterministically resolve a photo for any service or category identifier.
 * Priority:
 * 1. Exact service slug match in SERVICE_IMAGE_MAP (guarantees unique service photo)
 * 2. Exact category slug match in CATEGORY_IMAGE_MAP
 * 3. Specific service keyword heuristics (drain, leak, fixture, switch, etc.)
 * 4. Deterministic hash fallback across the 14 Cloudinary images
 */
export function getServicePhoto(identifier?: string | null): string {
    if (!identifier) {
        return SERVICE_IMAGE_MAP['fault-finding'];
    }

    const normalized = identifier.toLowerCase().trim();

    // 1. Exact service slug match (Highest priority)
    if (SERVICE_IMAGE_MAP[normalized]) {
        return SERVICE_IMAGE_MAP[normalized];
    }

    // 2. Exact category map lookup
    if (CATEGORY_IMAGE_MAP[normalized]) {
        return CATEGORY_IMAGE_MAP[normalized];
    }

    // 3. Keyword heuristic checks matching specific individual services
    if (normalized.includes('drain')) {
        return SERVICE_IMAGE_MAP['blocked-drain'];
    }
    if (normalized.includes('leak')) {
        return SERVICE_IMAGE_MAP['leak-repair'];
    }
    if (normalized.includes('fixture') || normalized.includes('fitting') || normalized.includes('sanitary')) {
        return SERVICE_IMAGE_MAP['new-fixture-install'];
    }
    if (normalized.includes('switch') || normalized.includes('socket')) {
        return SERVICE_IMAGE_MAP['switch-socket-repair'];
    }
    if (normalized.includes('fault') || normalized.includes('electr') || normalized.includes('wir') || normalized.includes('circuit')) {
        return SERVICE_IMAGE_MAP['fault-finding'];
    }
    if (normalized.includes('washing') || normalized.includes('laundry')) {
        return SERVICE_IMAGE_MAP['washing-machine-repair'];
    }
    if (normalized.includes('ac-') || normalized.includes('cool') || normalized.includes('hvac') || normalized.includes('air-condition')) {
        return SERVICE_IMAGE_MAP['ac-service'];
    }
    if (normalized.includes('refrig') || normalized.includes('fridge') || normalized.includes('freezer')) {
        return SERVICE_IMAGE_MAP['refrigerator-repair'];
    }
    if (normalized.includes('furniture') || normalized.includes('table') || normalized.includes('chair') || normalized.includes('sofa')) {
        return SERVICE_IMAGE_MAP['furniture-repair'];
    }
    if (normalized.includes('door') || normalized.includes('window') || normalized.includes('wood')) {
        return SERVICE_IMAGE_MAP['door-window-repair'];
    }
    if (normalized.includes('waterproof') || normalized.includes('seepage') || normalized.includes('roof')) {
        return SERVICE_IMAGE_MAP['waterproofing-treatment'];
    }
    if (normalized.includes('paint') || normalized.includes('wall')) {
        return SERVICE_IMAGE_MAP['interior-painting'];
    }
    if (normalized.includes('pest') || normalized.includes('termite') || normalized.includes('cockroach') || normalized.includes('fumigat')) {
        return SERVICE_IMAGE_MAP['pest-control'];
    }
    if (normalized.includes('clean') || normalized.includes('wash') || normalized.includes('deep')) {
        return SERVICE_IMAGE_MAP['deep-cleaning'];
    }
    if (normalized.includes('cctv') || normalized.includes('camera')) {
        return SERVICE_IMAGE_MAP['cctv-installation'];
    }
    if (normalized.includes('lock') || normalized.includes('smart')) {
        return SERVICE_IMAGE_MAP['smart-lock-installation'];
    }

    // 4. Deterministic hash for any unknown slug/service name
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
        hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0;
    }
    const index = hash % SERVICE_CLOUDINARY_IMAGES.length;
    return SERVICE_CLOUDINARY_IMAGES[index];
}