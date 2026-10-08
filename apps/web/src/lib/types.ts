export type Text = { en: string; ur: string };

export type ImageAsset = { url: string; alt: Text };

export type Category = {
  id: number;
  slug: string;
  name: Text;
  description: Text;
  image: ImageAsset;
  warrantyDays: number;
};

export type PricingModel = "FLAT" | "TIME_BASED" | "INSPECTION_FIRST";

export type Service = {
  id: number | string;
  categoryId: number;
  categorySlug: string;
  slug: string;
  name: Text;
  description: Text;
  pricingModel?: PricingModel;
  basePricePaisa: number;
  maxPricePaisa: number;
  visitFeePaisa: number;
  expectedDurationMin: number;
  warrantyDays: number;
  emergency: boolean;
  planEligible: boolean;
  image: ImageAsset;
  focus?: string;
  checklist: Text[];
};

export type Area = { id: number; slug: string; name: Text };

export type Provider = {
  id: string;
  slug: string;
  name: string;
  bio: Text;
  image: ImageAsset;
  /** Focal point for the portrait crop, e.g. "50% 30%". */
  focus?: string;
  rating: number;
  ratingCount: number;
  verifiedJobs: number;
  experienceYears: number;
  areas: string[];
  serviceSlugs: string[];
  qualification: Text;
  nextSlot: string;
};

export type Review = {
  id: string;
  providerId: string;
  serviceSlug: string;
  score: number;
  name: string;
  body: string;
  createdAt: string;
  verified: boolean;
};

export type BookingStatus =
  | "REQUESTED"
  | "SCHEDULED"
  | "EN_ROUTE"
  | "IN_PROGRESS"
  | "AWAITING_VERIFICATION"
  | "VERIFIED"
  | "COMPLETED"
  | "CANCELLED"
  | "DISPUTED";

export type Booking = {
  id: string;
  code: string;
  serviceSlug: string;
  providerId: string | null;
  areaSlug: string;
  customer: string;
  status: BookingStatus;
  paymentMode: "ONLINE" | "CASH";
  paymentStatus: "NONE" | "HELD" | "RELEASED" | "REFUNDED";
  scheduledStart: string;
  scheduledEnd: string;
  problem: string;
  quotedPaisa: number;
  finalPaisa: number | null;
  emergency: boolean;
};

export type VerificationStatus = "QUEUED" | "SUBMITTED" | "PASSED" | "REWORK" | "EXPIRED";
