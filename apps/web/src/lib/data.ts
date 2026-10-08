import type { Area, Booking, Category, ImageAsset, Provider, Review, Service, Text } from "@/lib/types";

const text = (en: string, ur: string): Text => ({ en, ur });

const image = (id: number, altEn: string, altUr: string, width = 1200): ImageAsset => ({
  url: `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=${width}`,
  alt: text(altEn, altUr),
});

export const categories: Category[] = [
  {
    id: 1,
    slug: "plumbing",
    name: text("Plumbing", "پلمبنگ"),
    description: text(
      "Leak diagnosis, pipe repairs, fixtures and water-system maintenance for busy Lahore homes.",
      "لیک، پائپ، فکسچر اور پانی کے نظام کی مرمت اور دیکھ بھال کی خدمتیں۔",
    ),
    image: image(16509869, "Plumber checking a household pipe", "گھر کی پائپ چیک کرتا ہوا پلمب"),
    warrantyDays: 30,
  },
  {
    id: 2,
    slug: "sanitary-bathroom",
    name: text("Sanitary & bathroom", "صحنیات اور باتھ روم"),
    description: text(
      "Bathroom fittings, drainage, concealed plumbing and sanitary fixture installation.",
      "باتھ روم کے فکسچرز، ڈرینیج اور صابن کی تنصیب و مرمت۔",
    ),
    image: image(7745941, "Clean modern bathroom with sanitary fixtures", "صاف جدید باتھ روم"),
    warrantyDays: 30,
  },
  {
    id: 3,
    slug: "electrical",
    name: text("Electrical", "بجلی"),
    description: text(
      "Safe household electrical repairs, installations, fault finding and safety checks.",
      "گھر کے بجلی کے کام، سیم کی مرمت اور حفاظتی جانچ۔",
    ),
    image: image(5691590, "Safe wiring inspection at a home distribution board", "گھر کے ڈسٹری بیوشن بورڈ پر محفوظ وائرنگ کی جانچ"),
    warrantyDays: 30,
  },
  {
    id: 4,
    slug: "appliance-repair",
    name: text("Appliance repair", "گھریلو آلات کی مرمت"),
    description: text(
      "Diagnosis and repair for washing machines, refrigerators, ACs and kitchen appliances.",
      "گھریلو مشینیں، فریج، اے سی اور باورچی خانے کے آلات کی مرمت۔",
    ),
    image: image(5591646, "Technician examining a home appliance", "گھریلو آلے کو دیکھتا ہوا ٹیکنیشن"),
    warrantyDays: 14,
  },
  {
    id: 5,
    slug: "carpentry-furniture",
    name: text("Carpentry & furniture", "نجاری و فرنیچر"),
    description: text(
      "Custom carpentry, furniture repair, door fitting and wood finishes for homes in Lahore.",
      "لکڑی کا کام، فرنیچر کی مرمت، دروازے اور لکڑی کے کام۔",
    ),
    image: image(1866149, "Repairing a wooden shelf and furniture piece", "لکڑی کے فرنیچر پر کام کرتا ہوا نجار"),
    warrantyDays: 30,
  },
  {
    id: 6,
    slug: "paint-masonry-waterproofing",
    name: text("Paint, masonry & waterproofing", "پینٹ، اینڈ سے تراش اور پانی سے بچاؤ"),
    description: text(
      "Interior and exterior painting, masonry repair and waterproofing for Lahore properties.",
      "اندرونی و باہری پینٹ، اینڈ سے تراش کی مرمت اور پانی سے بچاؤ۔",
    ),
    image: image(39238329, "Painter preparing a wall for a fresh finish", "نئے پینٹ کی تیاری کرتا ہوا پینٹر"),
    warrantyDays: 14,
  },
];

const defaultChecklist: Text[] = [
  text("Inspect and photograph the work area", "کام کے علاقے کا معائنہ اور تصویر لیں"),
  text("Complete the agreed service checklist", "متفق شدہ چیک لسٹ مکمل کریں"),
  text("Test the repair and share evidence", "مرمت کا ٹیسٹ کریں اور ثبوت شیئر کریں"),
];

function service(input: {
  id: number;
  categoryId: number;
  slug: string;
  name: Text;
  description: Text;
  price: number;
  max: number;
  fee?: number;
  duration: number;
  warranty: number;
  emergency?: boolean;
  plan?: boolean;
  image: ImageAsset;
  focus?: string;
}): Service {
  return {
    id: input.id,
    categoryId: input.categoryId,
    categorySlug: categories.find((item) => item.id === input.categoryId)?.slug ?? "",
    slug: input.slug,
    name: input.name,
    description: input.description,
    basePricePaisa: input.price,
    maxPricePaisa: input.max,
    visitFeePaisa: input.fee ?? 0,
    expectedDurationMin: input.duration,
    warrantyDays: input.warranty,
    emergency: input.emergency ?? false,
    planEligible: input.plan ?? false,
    image: input.image,
    focus: input.focus,
    checklist: defaultChecklist,
  };
}

export const services: Service[] = [
  service({ id: 101, categoryId: 1, slug: "leak-detection-and-repair", name: text("Leak detection and repair", "لیک کی تلاش اور مرمت"), description: text("Trace hidden pipe leaks, repair the failed joint and test the affected line.", "چھپی ہوئی پائپ کی لیک تلاش کر کے خراب جوڑ کی مرمت اور ٹیسٹ۔"), price: 650000, max: 1200000, duration: 90, warranty: 30, emergency: true, plan: true, image: image(16509869, "Pipe repair tools beside a household water line", "گھر کی پانی کی لائن کے پاس پائپ کے اوزار") }),
  service({ id: 102, categoryId: 1, slug: "water-pump-and-tank-installation", name: text("Water pump and tank installation", "واٹر پمپ اور ٹینک کی تنصیب"), description: text("Install or replace a domestic water pump, tank connections and automatic controls.", "گھریلو واٹر پمپ، ٹینک کے کنکشنز اور کنٹرولز نصب یا تبدیل کریں۔"), price: 120000, max: 250000, duration: 120, warranty: 30, emergency: true, plan: true, image: image(1668869, "Water pump installation near a home tank", "گھر کے ٹینک کے پاس واٹر پمپ کی تنصیب"), focus: "50% 28%" }),
  service({ id: 103, categoryId: 1, slug: "blocked-drain-and-sewer-clearing", name: text("Blocked drain and sewer clearing", "بند ڈرین اور سیور کی صفائی"), description: text("Inspect a blocked drain, identify the blockage and clear accessible household waste lines.", "بند ڈرین کا معائنہ کریں، گلوٹنے کی وجہ تلاش کریں اور لائن صاف کریں۔"), price: 450000, max: 900000, fee: 150000, duration: 75, warranty: 14, emergency: true, image: image(6240578, "A surface drain grate ready for clearing", "صاف کرنے کے لیے تیار ڈرین کا گریٹ"), focus: "50% 50%" }),
  service({ id: 104, categoryId: 2, slug: "bathroom-fixture-installation", name: text("Bathroom fixture installation", "باتھ روم فکسچر کی تنصیب"), description: text("Install taps, washbasins, toilets and shower sets with tested seals.", "نپ، واش بیسن، ٹوائلٹ اور شاور سیٹ انسیل کریں۔"), price: 550000, max: 1000000, duration: 120, warranty: 30, plan: true, image: image(7745941, "Bathroom fixtures being fitted in a tiled room", "باتھ روم فکسچر لگاتا ہوا کاریگر") }),
  service({ id: 105, categoryId: 2, slug: "water-heater-installation-and-servicing", name: text("Water heater installation & servicing", "واٹر ہیٹر کی تنصیب و سروسنگ"), description: text("Install, service and safety-check geysers with correct valves and connections.", "جالیوں کی تنصیب، سروسنگ اور حفاظتی جانچ۔"), price: 108000, max: 260000, duration: 90, warranty: 30, emergency: true, image: image(7859953, "Technician servicing a home water heater", "گھر کے واٹر ہیٹر کی سروسنگ"), focus: "50% 32%" }),
  service({ id: 106, categoryId: 2, slug: "bathroom-waterproofing", name: text("Bathroom waterproofing", "باتھ روم کی واٹر پروفنگ"), description: text("Seal wet areas, treat seepage and complete a tested waterproofing layer.", "گیلے علاقوں کو سیل کریں اور پانی سے بچاؤ کا تہہ ڈالتے ہیں۔"), price: 600000, max: 1200000, duration: 180, warranty: 30, image: image(39238334, "A waterproofing membrane being applied to a wall", "دیوار پر واٹر پروفنگ کی تہہ لگاتا ہوا کاریگر"), focus: "50% 45%" }),
  service({ id: 107, categoryId: 3, slug: "switch-socket-and-light-installation", name: text("Switch, socket and light installation", "سوئچ، ساکٹ اور لائٹ کی تنصیب"), description: text("Install and test switches, sockets and lighting with safe wiring.", "سوئچ، ساکٹ اور لائٹنگ محفوظ وائرنگ کے ساتھ لگائیں اور ٹیسٹ کریں۔"), price: 400000, max: 900000, duration: 75, warranty: 30, emergency: true, plan: true, image: image(442160, "Electrician installing a light switch", "بجلی کا سوئچ لگاتا ہوا بجلی کار") }),
  service({ id: 108, categoryId: 3, slug: "wiring-and-fault-finding", name: text("Wiring and fault finding", "وائرنگ اور فالتو کی تلاش"), description: text("Trace faults, replace damaged wiring and document the root cause.", "خراب وائرنگ کی تلاش، تبدیلی اور وجہ کی دستاویزات۔"), price: 450000, max: 1100000, duration: 90, warranty: 30, emergency: true, image: image(5691590, "Fault finding on a home distribution board", "گھر کے ڈسٹری بیوشن بورڈ پر فالتو کی تلاش"), focus: "50% 30%" }),
  service({ id: 109, categoryId: 3, slug: "main-panel-and-load-safety-check", name: text("Main panel and load safety check", "مین پینل اور لوڈ سیفٹی چیک"), description: text("Inspect the main panel, earthing and load safety with a written finding.", "مین پینل، آرٹنگ اور لوڈ کی حفاظت کا تحریری جائزہ۔"), price: 600000, max: 1200000, duration: 90, warranty: 30, plan: true, image: image(12207608, "A main electrical panel being safety checked", "گھر کے مرکزی بجلی پینل کی حفاظتی جانچ"), focus: "50% 45%" }),
  service({ id: 110, categoryId: 4, slug: "washing-machine-repair", name: text("Washing machine repair", "واشنگ مشین کی مرمت"), description: text("Diagnose and repair washing machines with a full test cycle.", "واشنگ مشین کی تشخیص، مرمت اور مکمل ٹیسٹ سائیکل۔"), price: 350000, max: 900000, duration: 75, warranty: 14, emergency: true, plan: true, image: image(5591646, "Technician repairing a washing machine", "واشنگ مشین کی مرمت کرتا ہوا ٹیکنیشن") }),
  service({ id: 111, categoryId: 4, slug: "refrigerator-and-ac-servicing", name: text("Refrigerator and AC servicing", "فریج اور اے سی کی سروسنگ"), description: text("Service refrigerators and air conditioners with cooling and power checks.", "فریج اور اے سی کی سروسنگ، کولنگ اور پاور چیک۔"), price: 300000, max: 800000, duration: 90, warranty: 14, plan: true, image: image(5463582, "Servicing a home air conditioner", "گھر کے اے سی کی سروسنگ"), focus: "50% 28%" }),
  service({ id: 112, categoryId: 4, slug: "kitchen-appliance-installation", name: text("Kitchen appliance installation", "باورچی خانے کے آلات کی تنصیب"), description: text("Install kitchen appliances with safe power and water connections.", "باورچی خانے کے آلات کی محفوظ پاور اور پانی کے کنکشن کے ساتھ تنصیب۔"), price: 280000, max: 700000, duration: 60, warranty: 14, plan: true, image: image(4832505, "A kitchen appliance installed in a home", "گھر کے باورچی میں لگایا گیا آلہ"), focus: "50% 55%" }),
  service({ id: 113, categoryId: 5, slug: "door-and-window-repair", name: text("Door and window repair", "دروازے اور کھڑکی کی مرمت"), description: text("Repair doors, windows, hinges, tracks and alignment.", "دروازوں، کھڑکیوں، ہنجز اور ٹریکس کی مرمت اور درستگی۔"), price: 400000, max: 900000, duration: 90, warranty: 30, plan: true, image: image(7483049, "Repairing a wooden door", "لکڑی کے دروازے کی مرمت") }),
  service({ id: 114, categoryId: 5, slug: "custom-furniture-repair", name: text("Custom furniture repair", "کسٹم فرنیچر کی مرمت"), description: text("Repair shelves, cabinets and custom woodwork without replacing more than needed.", "شیلف، کیبینٹ اور کسٹم لکڑی کا کام ضرورت کے مطابق مرمت۔"), price: 450000, max: 1000000, duration: 120, warranty: 30, image: image(1866149, "Repairing a wooden shelf", "لکڑی کی شیلف کی مرمت"), focus: "50% 30%" }),
  service({ id: 115, categoryId: 5, slug: "kitchen-cabinet-installation", name: text("Kitchen cabinet installation", "باورچی کیبینٹ کی تنصیب"), description: text("Measure, install and align kitchen cabinets with tested fittings.", "باورچی کیبینٹ ناپ کر لگائیں اور فٹنگ ٹیسٹ کریں۔"), price: 700000, max: 1600000, duration: 180, warranty: 30, plan: true, image: image(7746657, "Kitchen cabinet fittings being measured and aligned", "باورچی کیبینٹ فٹنگ ناپتے اور ترتیب دیتے ہوئے"), focus: "50% 50%" }),
  service({ id: 116, categoryId: 6, slug: "interior-and-exterior-painting", name: text("Interior and exterior painting", "اندرونی و باہری پینٹ"), description: text("Prepare, prime and paint interior or exterior surfaces with a tidy finish.", "اندرونی یا باہری سطحوں کی تیاری، پرائم اور صاف پینٹ۔"), price: 450000, max: 1400000, duration: 180, warranty: 14, plan: true, image: image(39238329, "Painter preparing a wall for a fresh finish", "نئے پینٹ کی تیاری کرتا ہوا پینٹر") }),
  service({ id: 117, categoryId: 6, slug: "masonry-repair-and-plaster", name: text("Masonry repair and plaster", "اینڈ سے تراش اور پلاسٹر"), description: text("Repair cracks, plaster damage and masonry defects with clean finishing.", "دراڑیں، پلاسٹر اور اینڈ کی خرابی کی مرمت۔"), price: 400000, max: 1000000, duration: 150, warranty: 14, image: image(5493658, "Repairing and plastering a wall", "دیوار کی مرمت اور پلاسٹر"), focus: "50% 30%" }),
  service({ id: 118, categoryId: 6, slug: "roof-and-terrace-waterproofing", name: text("Roof and terrace waterproofing", "چھت اور ٹیریس واٹر پروفنگ"), description: text("Seepage survey, preparation and waterproofing for roofs and terraces.", "چھت اور ٹیریس کے لیے رسائی کا معائنہ اور واٹر پروفنگ۔"), price: 650000, max: 1800000, duration: 240, warranty: 30, plan: true, image: image(36884223, "Roof and terrace waterproofing work in progress", "چھت اور ٹیریس پر واٹر پروفنگ کا کام جاری"), focus: "50% 40%" }),
];

/* Photography is assigned one role per band, so the same frame never appears
   twice on the homepage:
     hero ......... environmental technician, inside a home
     categories ... task photography
     process ...... technician in context
     professionals  portraits
   Hero and journey are deliberately distinct frames from every category. */
export const heroImage: ImageAsset = {
  url: "/images/auth-technician.jpg",
  alt: text(
    "Verified professional home technician ready for service in a modern home",
    "جدید گھر میں سروس کے لیے تیار تصدیق شدہ پیشہ ور ٹیکنیشن",
  ),
};

/* Single frame for the process journey: a professional on site, tools in hand. */
export const journeyImage: ImageAsset = {
  url: "/images/auth-technician-ceiling.jpg",
  alt: text(
    "Verified technicians performing precision installation and maintenance on site",
    "سائٹ پر درستگی کے ساتھ تنصیب اور دیکھ بھال کا کام کرتے ہوئے تصدیق شدہ کاریگر",
  ),
};

export const areas: Area[] = [
  { id: 1, slug: "dha-phase-5", name: text("DHA Phase 5", "ڈی ایچ اے فیز 5") },
  { id: 2, slug: "gulberg-iii", name: text("Gulberg III", "گلبرگ III") },
  { id: 3, slug: "johar-town", name: text("Johar Town", "جھار ٹاؤن") },
  { id: 4, slug: "lake-view", name: text("Lake View", "لیک ویو") },
  { id: 5, slug: "model-town", name: text("Model Town", "ماڈل ٹاؤن") },
  { id: 6, slug: "bahria-town", name: text("Bahria Town", "باہریہ ٹاؤن") },
  { id: 7, slug: "gulistan-e-jauhar", name: text("Gulistan-e-Jauhar", "گلستانِ جوہر") },
  { id: 8, slug: "lahore-cantonment", name: text("Lahore Cantonment", "لاہور کینٹمنٹ") },
  { id: 9, slug: "askari-10", name: text("Askari 10", "اسکری 10") },
  { id: 10, slug: "wapdas-town", name: text("Wapdas Town", "WAPDA ٹاؤن") },
  { id: 11, slug: "garden-town", name: text("Garden Town", "گارڈن ٹاؤن") },
  { id: 12, slug: "ferozepur-road", name: text("Ferozepur Road", "فیروزپور روڈ") },
];

/* One distinct, well-framed portrait per professional — no shared shoots,
   no full-body shots that crop badly, and no site hi-vis: these are people
   who come to a customer's home, not a construction crew. */
export const providers: Provider[] = [
  { id: "prv-ahmad-plumber", slug: "ahmad-plumber", name: "Ahmad Raza", bio: text("Plumber for leak diagnosis, pipe repair and water-system work across central Lahore.", "لاہور کے وسط میں لیک، پائپ اور پانی کے نظام کا تجربہ کار پلمب۔"), image: image(7480249, "Portrait of plumber Ahmad Raza", "پلمب احمد رضا کی تصویر", 900), focus: "50% 24%", rating: 4.9, ratingCount: 128, verifiedJobs: 412, experienceYears: 12, areas: ["gulberg-iii", "model-town", "garden-town", "johar-town"], serviceSlugs: ["leak-detection-and-repair", "water-pump-and-tank-installation", "blocked-drain-and-sewer-clearing"], qualification: text("Licensed plumber with CNIC and trade certificate verified", "لائسنس یافتہ پلمب، CNIC اور ٹریڈ سرٹیفکیٹ تصدیق شدہ"), nextSlot: "2026-09-26T10:00:00+05:00" },
  { id: "prv-bilal-plumbing", slug: "bilal-plumbing", name: "Bilal Anwar", bio: text("Drain and sewer specialist for blocked lines and bathroom plumbing.", "بند ڈرین، سیور اور باتھ روم پلمبنگ کا ماہر۔"), image: image(8642041, "Portrait of drain specialist Bilal Anwar", "پلمب بلال انوار کی تصویر", 900), focus: "50% 26%", rating: 4.8, ratingCount: 96, verifiedJobs: 305, experienceYears: 9, areas: ["johar-town", "gulistan-e-jauhar", "ferozepur-road", "wapdas-town"], serviceSlugs: ["blocked-drain-and-sewer-clearing", "leak-detection-and-repair", "bathroom-fixture-installation"], qualification: text("Trade-tested drain specialist", "ٹریڈ ٹیسٹڈ ڈرین ماہر"), nextSlot: "2026-09-26T12:30:00+05:00" },
  { id: "prv-sana-sanitary", slug: "sana-sanitary", name: "Sana Iqbal", bio: text("Bathroom fixture and water-heater specialist with tidy site protection.", "باتھ روم فکسچر اور واٹر ہیٹر کی ماہر، سائٹ کی حفاظت کے ساتھ۔"), image: image(7006684, "Portrait of sanitary specialist Sana Iqbal", "صحنیات ماہر ثنا اقبال کی تصویر", 900), focus: "50% 22%", rating: 5, ratingCount: 84, verifiedJobs: 288, experienceYears: 10, areas: ["dha-phase-5", "lake-view", "bahria-town", "model-town"], serviceSlugs: ["bathroom-fixture-installation", "water-heater-installation-and-servicing", "bathroom-waterproofing"], qualification: text("Verified sanitary and heater fitter", "تصدیق شدہ صابن اور ہیٹر فٹر"), nextSlot: "2026-09-26T09:15:00+05:00" },
  { id: "prv-usman-electrician", slug: "usman-electrician", name: "Usman Tariq", bio: text("Electrician for fault finding, panel safety and tested installations.", "فالتو، پینل سیفٹی اور تنصیب کے لیے بجلی کار۔"), image: image(5973906, "Portrait of electrician Usman Tariq", "بجلی کار عثمان طارق کی تصویر", 900), focus: "50% 24%", rating: 4.9, ratingCount: 112, verifiedJobs: 366, experienceYears: 11, areas: ["gulberg-iii", "lahore-cantonment", "askari-10", "garden-town"], serviceSlugs: ["switch-socket-and-light-installation", "wiring-and-fault-finding", "main-panel-and-load-safety-check"], qualification: text("Electrical contractor with load-safety training", "لوڈ سیفٹی ٹریننگ کے ساتھ الیکٹریکل ٹھیکیدار"), nextSlot: "2026-09-26T11:00:00+05:00" },
  { id: "prv-imran-appliance", slug: "imran-appliance", name: "Imran Shah", bio: text("Appliance technician for washing machines, refrigerators and AC servicing.", "واشنگ مشین، فریج اور اے سی کی سروسنگ کے لیے ٹیکنیشن۔"), image: image(7480449, "Portrait of appliance technician Imran Shah", "آلہ ٹیکنیشن عمران شاہ کی تصویر", 900), focus: "50% 22%", rating: 4.8, ratingCount: 76, verifiedJobs: 241, experienceYears: 8, areas: ["johar-town", "ferozepur-road", "wapdas-town", "gulistan-e-jauhar"], serviceSlugs: ["washing-machine-repair", "refrigerator-and-ac-servicing", "kitchen-appliance-installation"], qualification: text("Certified home-appliance technician", "سرٹیفائیڈ ہوم ایپلینس ٹیکنیشن"), nextSlot: "2026-09-26T13:00:00+05:00" },
  { id: "prv-kashif-carpenter", slug: "kashif-carpenter", name: "Kashif Mehmood", bio: text("Carpenter for doors, windows, cabinets and careful wood finishes.", "دروازے، کھڑکی، کابینٹ اور لکڑی کے خوبصورت کام کے لیے نجار۔"), image: image(7483033, "Portrait of carpenter Kashif Mehmood", "نجار کاشف محمود کی تصویر", 900), focus: "50% 22%", rating: 4.9, ratingCount: 68, verifiedJobs: 198, experienceYears: 13, areas: ["dha-phase-5", "lake-view", "bahria-town", "lahore-cantonment"], serviceSlugs: ["door-and-window-repair", "custom-furniture-repair", "kitchen-cabinet-installation"], qualification: text("Verified furniture and door-fixing specialist", "تصدیق شدہ فرنیچر اور ڈور فکسنگ ماہر"), nextSlot: "2026-09-26T14:30:00+05:00" },
  { id: "prv-nadia-paint", slug: "nadia-paint", name: "Nadia Farooq", bio: text("Painter and masonry specialist for interior repainting and waterproofing.", "اندرونی پینٹ، اینڈ سے تراش اور واٹر پروفنگ کی ماہر۔"), image: image(7006676, "Portrait of painter Nadia Farooq", "پینٹر نادیہ فاروق کی تصویر", 900), focus: "50% 22%", rating: 4.8, ratingCount: 91, verifiedJobs: 276, experienceYears: 10, areas: ["gulistan-e-jauhar", "wapdas-town", "bahria-town", "askari-10"], serviceSlugs: ["interior-and-exterior-painting", "masonry-repair-and-plaster", "roof-and-terrace-waterproofing"], qualification: text("Verified painter with surface-preparation training", "تصدیق شدہ پینٹر، سطح کی تیاری کی تربیت کے ساتھ"), nextSlot: "2026-09-26T15:45:00+05:00" },
];


export const reviews: Review[] = [
  { id: "rev-001", providerId: "prv-ahmad-plumber", serviceSlug: "leak-detection-and-repair", score: 5, name: "Ayesha K.", body: "Arrived on time, explained the leak source and left the cabinet area clean.", createdAt: "2026-09-18T12:20:00+05:00", verified: true },
  { id: "rev-002", providerId: "prv-ahmad-plumber", serviceSlug: "water-pump-and-tank-installation", score: 4.5, name: "Hamza P.", body: "The pump is noticeably quieter and the connections were checked carefully.", createdAt: "2026-09-24T12:30:00+05:00", verified: true },
  { id: "rev-003", providerId: "prv-bilal-plumbing", serviceSlug: "blocked-drain-and-sewer-clearing", score: 4.5, name: "Bilal R.", body: "Cleared the drain quickly and showed us where the blockage had formed.", createdAt: "2026-09-16T10:40:00+05:00", verified: true },
  { id: "rev-004", providerId: "prv-sana-sanitary", serviceSlug: "bathroom-fixture-installation", score: 5, name: "Hina S.", body: "Neat fixture fitting and a clear explanation of the seal work.", createdAt: "2026-09-20T14:10:00+05:00", verified: true },
  { id: "rev-005", providerId: "prv-usman-electrician", serviceSlug: "wiring-and-fault-finding", score: 5, name: "Fatima N.", body: "Safe, tidy electrical work and every fitting was tested before leaving.", createdAt: "2026-09-21T10:20:00+05:00", verified: true },
  { id: "rev-006", providerId: "prv-imran-appliance", serviceSlug: "washing-machine-repair", score: 4.5, name: "Mariam T.", body: "The machine drained properly after the repair and the test cycle was shown.", createdAt: "2026-09-19T13:45:00+05:00", verified: true },
  { id: "rev-007", providerId: "prv-kashif-carpenter", serviceSlug: "door-and-window-repair", score: 5, name: "Sadia I.", body: "The door now closes smoothly and the work area was protected properly.", createdAt: "2026-09-17T11:00:00+05:00", verified: true },
  { id: "rev-008", providerId: "prv-nadia-paint", serviceSlug: "interior-and-exterior-painting", score: 5, name: "Rabia F.", body: "The room was protected well, the finish is even and the handover was tidy.", createdAt: "2026-09-14T15:00:00+05:00", verified: true },
];

export const bookings: Booking[] = [
  { id: "bk-1030", code: "SHM-0001030", serviceSlug: "leak-detection-and-repair", providerId: "prv-ahmad-plumber", areaSlug: "gulberg-iii", customer: "Ayesha K.", status: "AWAITING_VERIFICATION", paymentMode: "ONLINE", paymentStatus: "HELD", scheduledStart: "2026-09-25T16:00:00+05:00", scheduledEnd: "2026-09-25T17:30:00+05:00", problem: "Water is leaking below the kitchen sink and the cabinet base is damp.", quotedPaisa: 850000, finalPaisa: null, emergency: false },
  { id: "bk-1031", code: "SHM-0001031", serviceSlug: "switch-socket-and-light-installation", providerId: "prv-usman-electrician", areaSlug: "askari-10", customer: "Omar D.", status: "DISPUTED", paymentMode: "ONLINE", paymentStatus: "HELD", scheduledStart: "2026-09-24T10:00:00+05:00", scheduledEnd: "2026-09-24T11:15:00+05:00", problem: "Two sockets in the lounge stopped working after a power fluctuation.", quotedPaisa: 420000, finalPaisa: null, emergency: false },
  { id: "bk-1032", code: "SHM-0001032", serviceSlug: "interior-and-exterior-painting", providerId: null, areaSlug: "johar-town", customer: "Rabia F.", status: "REQUESTED", paymentMode: "CASH", paymentStatus: "NONE", scheduledStart: "2026-09-26T14:00:00+05:00", scheduledEnd: "2026-09-26T17:00:00+05:00", problem: "Two bedrooms and a lounge need repainting before the month ends.", quotedPaisa: 950000, finalPaisa: null, emergency: false },
  { id: "bk-1033", code: "SHM-0001033", serviceSlug: "washing-machine-repair", providerId: "prv-imran-appliance", areaSlug: "ferozepur-road", customer: "Mariam T.", status: "SCHEDULED", paymentMode: "CASH", paymentStatus: "NONE", scheduledStart: "2026-09-26T11:00:00+05:00", scheduledEnd: "2026-09-26T12:15:00+05:00", problem: "The front loader stops mid-cycle and shows an error code.", quotedPaisa: 520000, finalPaisa: null, emergency: false },
  { id: "bk-1034", code: "SHM-0001034", serviceSlug: "door-and-window-repair", providerId: "prv-kashif-carpenter", areaSlug: "dha-phase-5", customer: "Sadia I.", status: "IN_PROGRESS", paymentMode: "ONLINE", paymentStatus: "HELD", scheduledStart: "2026-09-25T15:00:00+05:00", scheduledEnd: "2026-09-25T16:30:00+05:00", problem: "The bedroom door hinge has come loose and the door no longer closes.", quotedPaisa: 400000, finalPaisa: null, emergency: true },
  { id: "bk-1035", code: "SHM-0001035", serviceSlug: "bathroom-fixture-installation", providerId: "prv-sana-sanitary", areaSlug: "bahria-town", customer: "Hina S.", status: "COMPLETED", paymentMode: "CASH", paymentStatus: "RELEASED", scheduledStart: "2026-09-22T10:30:00+05:00", scheduledEnd: "2026-09-22T12:30:00+05:00", problem: "Replace a toilet seat and check the flush connection.", quotedPaisa: 560000, finalPaisa: 560000, emergency: false },
  { id: "bk-1036", code: "SHM-0001036", serviceSlug: "blocked-drain-and-sewer-clearing", providerId: null, areaSlug: "johar-town", customer: "Omar D.", status: "REQUESTED", paymentMode: "CASH", paymentStatus: "NONE", scheduledStart: "2026-09-26T16:00:00+05:00", scheduledEnd: "2026-09-26T17:15:00+05:00", problem: "A ground-floor drain is backing up and needs clearing.", quotedPaisa: 420000, finalPaisa: null, emergency: true },
  { id: "bk-1037", code: "SHM-0001037", serviceSlug: "water-heater-installation-and-servicing", providerId: "prv-sana-sanitary", areaSlug: "model-town", customer: "Bilal R.", status: "VERIFIED", paymentMode: "ONLINE", paymentStatus: "RELEASED", scheduledStart: "2026-09-24T09:00:00+05:00", scheduledEnd: "2026-09-24T10:30:00+05:00", problem: "Geyser is not heating and trips the safety valve.", quotedPaisa: 190000, finalPaisa: 190000, emergency: true },
];

export const getCategories = () => categories;
export const getCategory = (slug: string) => categories.find((item) => item.slug === slug);
export const getServices = () => services;
export const getService = (slug: string) => services.find((item) => item.slug === slug);
export const getServicesByCategory = (slug: string) => services.filter((item) => item.categorySlug === slug);
export const getAreas = () => areas;
export const getArea = (slug: string) => areas.find((item) => item.slug === slug);
export const getProviders = () => providers;
export const getProvider = (slug: string) => providers.find((item) => item.slug === slug);
export const getProvidersForService = (slug: string) => providers.filter((item) => item.serviceSlugs.includes(slug));
export const getReviews = () => reviews;
export const getBookings = () => bookings;
export const getBooking = (id: string) => bookings.find((item) => item.id === id);
export const getBookingsForProvider = (id: string) => bookings.filter((item) => item.providerId === id);
export const getRequestedBookings = () => bookings.filter((item) => item.status === "REQUESTED" && item.providerId === null);
