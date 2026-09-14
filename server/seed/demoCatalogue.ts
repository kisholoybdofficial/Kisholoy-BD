/**
 * Demo catalogue data.
 *
 * The point of this file is to prove the catalogue model is genuinely
 * product-agnostic: the twenty items below deliberately span food, grocery,
 * handmade, home, personal care, apparel, accessories, stationery and gifts.
 * Nothing in the schema knows what "food" is — the perishable items carry a
 * shelf-life attribute, the electronics carry a warranty block, the apparel
 * carries size variants, and that is the whole difference.
 *
 * Deliberately NOT included: credentials, payment data, or anything that would
 * let a demo account authenticate. Demo shoppers get no password, so they
 * cannot be signed into.
 *
 * @license Apache-2.0
 */

import type { Category, CouponRule, Customer, Product, Supplier } from '../../src/types';

export const DEMO_IMAGE_BASE = '/products';

const img = (slug: string): string => `${DEMO_IMAGE_BASE}/${slug}.jpg`;

/** 10 top-level categories across unrelated verticals (no food bias). */
export const DEMO_CATEGORIES: Category[] = [
  {
    id: 'cat-food', name: 'Food & Snacks', nameBn: 'খাবার ও হালকা নাশতা', slug: 'food-snacks',
    description: 'Shelf-stable Bangladeshi snacks, pickles, cakes and biscuits from small kitchens.',
    descriptionBn: 'ছোট কিচেন থেকে তৈরি দীর্ঘস্থায়ী খাবার, আচার, কেক ও বিস্কুট।',
    image: `${DEMO_IMAGE_BASE}/chui-jhal-classic.jpg`, itemCount: 0, featured: true, level: 0, order: 1, status: 'ACTIVE',
    handling: { fragile: true, perishable: true, temperature: 'AMBIENT', maxUnitsPerParcel: 20 },
    attributeTemplate: [
      { key: 'net_weight', label: 'Net Weight', labelBn: 'ওজন', dataType: 'MEASURE', unit: 'g', required: true, filterable: true, showInSpecTable: true },
      { key: 'shelf_life_months', label: 'Shelf Life', labelBn: 'মেয়াদ', dataType: 'NUMBER', unit: 'months', required: true, filterable: true, showInSpecTable: true },
      { key: 'storage', label: 'Storage', labelBn: 'সংরক্ষণ', dataType: 'TEXT', showInSpecTable: true },
      { key: 'allergens', label: 'Allergen Advice', labelBn: 'অ্যালার্জেন', dataType: 'TEXT', showInSpecTable: true },
    ],
    seo: { title: 'Food & Snacks | KISHOLOY', titleBn: 'খাবার ও নাশতা | কিশলয়', description: 'Handmade, shelf-stable Bangladeshi food gifts and snacks.' },
  },
  {
    id: 'cat-grocery', name: 'Grocery & Pantry', nameBn: 'মুদি ও নিত্যপণ্য', slug: 'grocery',
    description: 'Everyday pantry staples sourced from millers and co-operatives.',
    descriptionBn: 'ডিলার ও সমবায় থেকে সংগৃহীত নিত্যপ্রয়োজনীয় পণ্য।',
    image: `${DEMO_IMAGE_BASE}/rice-5kg.jpg`, itemCount: 0, level: 0, order: 2, status: 'ACTIVE',
    handling: { perishable: false, temperature: 'AMBIENT', maxUnitsPerParcel: 40 },
    attributeTemplate: [
      { key: 'net_weight', label: 'Net Weight', labelBn: 'ওজন', dataType: 'MEASURE', unit: 'kg', filterable: true, showInSpecTable: true },
      { key: 'grade', label: 'Grade', labelBn: 'গ্রেড', dataType: 'SELECT', options: ['Premium', 'Standard'], showInSpecTable: true },
    ],
  },
  {
    id: 'cat-handmade', name: 'Handmade & Artisan', nameBn: 'হস্তশিল্প', slug: 'handmade',
    description: 'Small-batch craft from independent makers, sold on a vendor commission model.',
    descriptionBn: 'স্বনির্ভর কারিগরের হাতে-তৈরি পণ্য, ভেন্ডর কমিশন মডেলে।',
    image: `${DEMO_IMAGE_BASE}/mango-pickle.jpg`, itemCount: 0, featured: true, level: 0, order: 3, status: 'ACTIVE',
    handling: { fragile: true, maxUnitsPerParcel: 12 },
    attributeTemplate: [
      { key: 'material', label: 'Material', labelBn: 'উপকরণ', dataType: 'TEXT', required: true, filterable: true, showInSpecTable: true },
      { key: 'maker_region', label: 'Maker Region', labelBn: 'অঞ্চল', dataType: 'TEXT', filterable: true, showInSpecTable: true },
      { key: 'made_to_order', label: 'Made to Order', labelBn: 'অর্ডারে তৈরি', dataType: 'BOOLEAN', showInSpecTable: true },
    ],
  },
  {
    id: 'cat-home', name: 'Home & Kitchen', nameBn: 'ঘর ও রান্নাঘর', slug: 'home-kitchen',
    description: 'Practical household goods and kitchenware.',
    descriptionBn: 'দৈনন্দিন ঘর ও রান্নাঘরের পণ্য।',
    image: `${DEMO_IMAGE_BASE}/tiffin-box.jpg`, itemCount: 0, level: 0, order: 4, status: 'ACTIVE',
    attributeTemplate: [
      { key: 'material', label: 'Material', labelBn: 'উপকরণ', dataType: 'TEXT', filterable: true, showInSpecTable: true },
      { key: 'capacity_ml', label: 'Capacity', labelBn: 'ধারণক্ষমতা', dataType: 'MEASURE', unit: 'ml', showInSpecTable: true },
      { key: 'dishwasher_safe', label: 'Dishwasher Safe', labelBn: 'ডিশওয়াশার নিরাপদ', dataType: 'BOOLEAN', showInSpecTable: true },
    ],
  },
  {
    id: 'cat-beauty', name: 'Beauty & Personal Care', nameBn: 'প্রসাধন ও ব্যক্তিগত যত্ন', slug: 'beauty-personal-care',
    description: 'Skincare, haircare and bath essentials.',
    descriptionBn: 'ত্বক, চুল ও গোসলের পণ্য।',
    image: `${DEMO_IMAGE_BASE}/neem-soap.jpg`, itemCount: 0, level: 0, order: 5, status: 'ACTIVE',
    handling: { fragile: true, maxUnitsPerParcel: 12 },
    attributeTemplate: [
      { key: 'volume_ml', label: 'Volume', labelBn: 'আয়তন', dataType: 'MEASURE', unit: 'ml', required: true, showInSpecTable: true },
      { key: 'skin_type', label: 'Suitable Skin Type', labelBn: 'ত্বকের ধরন', dataType: 'SELECT', options: ['All', 'Dry', 'Oily', 'Sensitive'], filterable: true, showInSpecTable: true },
      { key: 'expiry', label: 'Expiry', labelBn: 'মেয়াদ', dataType: 'DATE', showInSpecTable: true },
    ],
  },
  {
    id: 'cat-apparel', name: 'Apparel & Accessories', nameBn: 'পোশাক ও আনুষাঙ্গিক', slug: 'apparel',
    description: 'Clothing and wearables, sold with size variants.',
    descriptionBn: 'সাইজ ভ্যারিয়েন্টসহ পোশাক ও পরিধানের পণ্য।',
    image: `${DEMO_IMAGE_BASE}/katan-panjabi.jpg`, itemCount: 0, level: 0, order: 6, status: 'ACTIVE',
    attributeTemplate: [
      { key: 'fabric', label: 'Fabric', labelBn: 'কাপড়', dataType: 'TEXT', filterable: true, showInSpecTable: true },
      { key: 'size_range', label: 'Sizes', labelBn: 'সাইজ', dataType: 'MULTI_SELECT', options: ['S', 'M', 'L', 'XL', 'XXL'], filterable: true, showInSpecTable: true },
      { key: 'care', label: 'Care', labelBn: 'যত্ন', dataType: 'TEXT', showInSpecTable: true },
    ],
  },
  {
    id: 'cat-electronics', name: 'Electronics & Accessories', nameBn: 'ইলেকট্রনিকস ও আনুষাঙ্গিক', slug: 'electronics',
    description: 'Everyday gadget accessories with warranty handling.',
    descriptionBn: 'নিত্যপ্রয়োজনীয় গ্যাজেট আনুষাঙ্গিক, ওয়ারন্টিসহ।',
    image: `${DEMO_IMAGE_BASE}/fast-charger.jpg`, itemCount: 0, level: 0, order: 7, status: 'ACTIVE',
    attributeTemplate: [
      { key: 'warranty_months', label: 'Warranty', labelBn: 'ওয়ারন্টি', dataType: 'NUMBER', unit: 'months', required: true, filterable: true, showInSpecTable: true },
      { key: 'compatibility', label: 'Compatibility', labelBn: 'সামঞ্জস্য', dataType: 'TEXT', showInSpecTable: true },
      { key: 'output', label: 'Output', labelBn: 'আউটপুট', dataType: 'TEXT', showInSpecTable: true },
    ],
  },
  {
    id: 'cat-stationery', name: 'Stationery & Office', nameBn: 'স্টেশনারি ও অফিস', slug: 'stationery',
    description: 'Paper goods, journals and desk supplies.',
    descriptionBn: 'কাগজপত্র, জার্নাল ও ডেস্কের সামগ্রী।',
    image: `${DEMO_IMAGE_BASE}/khutki-journal.jpg`, itemCount: 0, level: 0, order: 8, status: 'ACTIVE',
    attributeTemplate: [
      { key: 'pages', label: 'Pages', labelBn: 'পাতা', dataType: 'NUMBER', showInSpecTable: true },
      { key: 'paper_gsm', label: 'Paper GSM', labelBn: 'কাগজের মান', dataType: 'NUMBER', showInSpecTable: true },
    ],
  },
  {
    id: 'cat-gifts', name: 'Gifts & Hampers', nameBn: 'উপহার ও হ্যাম্পার', slug: 'gifts',
    description: 'Curated gift boxes and hampers for occasions.',
    descriptionBn: 'উৎসব ও অনুষ্ঠানের জন্য সাজানো উপহার।',
    image: `${DEMO_IMAGE_BASE}/gratitude-hamper.jpg`, itemCount: 0, featured: true, level: 0, order: 9, status: 'ACTIVE',
    handling: { fragile: true, maxUnitsPerParcel: 8 },
    attributeTemplate: [
      { key: 'occasion', label: 'Occasion', labelBn: 'উপলক্ষ', dataType: 'MULTI_SELECT', options: ['Birthday', 'Wedding', 'Corporate', 'Eid', 'Gratitude'], filterable: true, showInSpecTable: true },
      { key: 'includes', label: 'Inside the Box', labelBn: 'যা আছে', dataType: 'TEXT', showInSpecTable: true },
    ],
  },
  {
    id: 'cat-lifestyle', name: 'Lifestyle & Decor', nameBn: 'লাইফস্টাইল ও সাজসজ্জা', slug: 'lifestyle',
    description: 'Objects for the home and everyday ritual.',
    descriptionBn: 'ঘর সাজানো ও দৈনন্দিন অভ্যাসের জিনিস।',
    image: `${DEMO_IMAGE_BASE}/nagro-basket.jpg`, itemCount: 0, level: 0, order: 10, status: 'ACTIVE',
    attributeTemplate: [
      { key: 'material', label: 'Material', labelBn: 'উপকরণ', dataType: 'TEXT', filterable: true, showInSpecTable: true },
      { key: 'dimensions_cm', label: 'Dimensions', labelBn: 'মাপ', dataType: 'TEXT', showInSpecTable: true },
    ],
  },
];

/**
 * Vendors / entrepreneur partners. `id` doubles as the product `vendorId`.
 * No portal credentials here — see `server/supplierCredentials.ts`, which
 * derives them from the environment so a seeded vendor can never be signed into.
 */
export const DEMO_VENDORS: Array<Partial<Supplier> & { id: string; code: string; companyName: string; district: string }> = [
  {
    id: 'sup-komodpur', code: 'SUP-9001', companyName: 'Komodpur Kitchen (Entrepreneur)', contactPerson: 'Rehana Parvin',
    email: 'komodpur.kitchen@example.com', phone: '+8801711000901', address: 'Komodpur, Ward 9', district: 'Jashore', division: 'Khulna',
    categoriesSupplied: ['Food & Snacks', 'Gifts & Hampers'], status: 'ACTIVE', paymentTermsDays: 15,
    notes: 'Entrepreneur partner — bakes and packs at home; platform takes 12% commission.',
  },
  {
    id: 'sup-sundarban', code: 'SUP-9002', companyName: 'Sundarban Forest Honey Co-operative', contactPerson: 'Abdul Karim Sheikh',
    email: 'sundarban.honey@example.com', phone: '+8801711000902', address: 'Kachikuri Range', district: 'Khulna', division: 'Khulna',
    categoriesSupplied: ['Food & Snacks', 'Grocery & Pantry'], status: 'ACTIVE', paymentTermsDays: 30,
    notes: 'Co-operative of 24 honey collectors; seasonal supply.',
  },
  {
    id: 'sup-nakra', code: 'SUP-9003', companyName: 'Nakra Craft Collective', contactPerson: 'Ruma Chakma',
    email: 'nakra.crafts@example.com', phone: '+8801711000903', address: 'Bailtali Para', district: 'Rangamati', division: 'Chattogram',
    categoriesSupplied: ['Handmade & Artisan', 'Lifestyle & Decor', 'Stationery & Office'], status: 'ACTIVE', paymentTermsDays: 21,
    notes: '12 artisans; weaving, bamboo and clay work. Made-to-order lead time 5-7 days.',
  },
  {
    id: 'sup-kisholoy', code: 'SUP-9000', companyName: 'KISHOLOY Own Inventory (In-House)', contactPerson: 'Procurement Desk',
    email: 'procurement@kisholoy.com', phone: '+8801700000000', address: 'Hazaribagh Warehouse', district: 'Dhaka', division: 'Dhaka',
    categoriesSupplied: ['Home & Kitchen', 'Beauty & Personal Care', 'Electronics & Accessories', 'Apparel & Accessories'],
    status: 'ACTIVE', paymentTermsDays: 0, notes: 'Own-stock supplier record used for in-house costing and margin reporting.',
  },
];

interface DemoSeed {
  product: Product;
  /** Vendor commission percentage, when the item is not in-house. */
  commission?: number;
}

type DemoSpec = Partial<Product> &
  Pick<Product, 'title' | 'titleBn' | 'slug' | 'sku' | 'price' | 'category' | 'categorySlug' | 'description' | 'descriptionBn'>;

const base = (spec: DemoSpec): Product => ({
  id: `prod-${spec.sku.toLowerCase()}`,
  rating: 0,
  reviewsCount: 0,
  readyToShip: true,
  status: 'ACTIVE',
  trackInventory: true,
  sellingModel: 'IN_HOUSE',
  productType: 'PHYSICAL',
  costPrice: 0,
  images: [],
  stock: 0,
  price: 0,
  sku: '',
  category: '',
  categorySlug: '',
  title: '',
  titleBn: '',
  slug: '',
  description: '',
  descriptionBn: '',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  publishedAt: new Date().toISOString(),
  ...spec,
  isDemo: true,
});

export const DEMO_PRODUCTS: DemoSpec[] = [
  // ── FOOD (in-house) ───────────────────────────────────────────────────────
  base({
    id: 'prod-chuijhal-classic',
    title: 'Classic Chui Jhal (500g Jar)', titleBn: 'ক্লাসিক চুই ঝাল (৫০০ গ্রাম)',
    slug: 'classic-chui-jhal-500g', sku: 'KSH-FD-CHJ-500',
    shortDescription: 'Slow-cooked spicy-sweet chui jhal in mustard oil. Family recipe, no preservatives.',
    shortDescriptionBn: 'সরিষার তেলে ধীরে রান্না ঝাল-মিষ্টি চুই ঝাল। পারিবারিক রেসিপি, কোনো প্রিজারভেটিভ নেই।',
    description: 'A 500g glass jar of traditional chui jhal made in our own licensed kitchen in Jashore. Radishes are sun-dried, then cooked for six hours with date-treacle (khejur gur), nigella, panch phoron and mustard oil. Comes with a wooden spoon and a resealable lid.',
    descriptionBn: 'ঝিনাইদার নিজস্ব লাইসেন্সপ্রাপ্ত কিচেনে তৈরি ৫০০ গ্রাম কাঁচের বয়াম চুই ঝাল। আলু মশলা রোদে শুকিয়ে খেজুর গুড়, কালোজিরা, পঁচফোড়ন ও সরিষার তেলে ছয় ঘণ্টা রান্না করা হয়। কাঠের চামচ ও রিসিলযোগ্য ঢাকনাসহ পাঠানো হয়।',
    category: 'Food & Snacks', categorySlug: 'food-snacks', subcategory: 'Pickles & Preserves', subcategorySlug: 'pickles',
    brand: 'KISHOLOY Kitchen', price: 420, originalPrice: 480, costPrice: 240, stock: 180, lowStockThreshold: 30, unit: 'jar', unitBn: 'বয়াম',
    weightGrams: 700, images: [img('chui-jhal-classic')], thumbnail: img('chui-jhal-classic'),
    gallery: [{ url: img('chui-jhal-classic'), alt: 'Chui jhal in a glass jar with wooden spoon', altBn: 'কাঁচের বয়ামে চুই ঝাল ও কাঠের চামচ' }],
    tags: ['pickle', 'chui jhal', 'spicy', 'jashore', 'no-preservative'],
    attributes: { material: 'Mustard oil, radish, date treacle', origin: 'Jashore, Bangladesh', weight: '500 g' },
    customAttributes: [
      { key: 'net_weight', label: 'Net Weight', value: 500, unit: 'g', dataType: 'MEASURE', filterable: true },
      { key: 'shelf_life_months', label: 'Shelf Life', value: 8, unit: 'months', dataType: 'NUMBER', filterable: true },
      { key: 'storage', label: 'Storage', value: 'Cool, dry place. Refrigerate after opening.', dataType: 'TEXT' },
      { key: 'allergens', label: 'Allergen Advice', value: 'Contains mustard. Trace sesame.', dataType: 'TEXT' },
    ],
    returnPolicy: { returnable: false, exceptions: 'Sealed food items cannot be returned once opened.', exceptionsBn: 'খোলা খাদ্য পণ্য ফেরত দেওয়া যায় না।', restockable: false },
    seo: { title: 'Classic Chui Jhal 500g — KISHOLOY', description: 'Handmade Jashori chui jhal in mustard oil, 500g jar. No preservatives.', keywords: ['chui jhal', 'bangladeshi pickle', 'jashore'] },
    procurement: { reorderPoint: 40, reorderQuantity: 150, storageLocation: 'DHK-A1', batchTracked: true },
    isFeatured: true, isBestseller: true,
  }),

  // ── FOOD (vendor) ─────────────────────────────────────────────────────────
  base({
    id: 'prod-sundarban-honey',
    title: 'Sundarbans Wild Forest Honey 500g', titleBn: 'সুন্দরবনের বনমধু ৫০০ গ্রাম',
    slug: 'sundarbans-wild-forest-honey-500g', sku: 'KSH-FD-HNY-500',
    shortDescription: 'Raw, unfiltered multi-floral honey collected by forest-fragment cooperatives.',
    shortDescriptionBn: 'বনফুলের কাঁচা, অ-পরিশোধিত মধু—বনবিভাগের সমবায় থেকে সংগ্রহীত।',
    description: 'Harvested twice a year from the forest fringe by licensed collectors of the Kachikuri co-operative. Bottled raw — expect natural crystallisation over time, which is a sign of real honey, not spoilage. Each jar carries its collection batch code.',
    descriptionBn: 'কাচিকুরি সমবায়ের লাইসেন্সপ্রাপ্ত সংগ্রাহকরা বছরে দুবার সংগ্রহ করা মধু। কাঁচা অবস্থায় বোতলজাত—সময় केটে কেলাসিত হলে তা প্রকৃত মধুর লক্ষণ, নষ্ট হওয়ার নয়। প্রতিটি বোতলে ব্যাচ কোড থাকে।',
    category: 'Food & Snacks', categorySlug: 'food-snacks', subcategory: 'Honey & Syrups', subcategorySlug: 'honey',
    brand: 'Sundarban Co-operative', price: 890, originalPrice: 990, costPrice: 610, stock: 96, lowStockThreshold: 20, unit: 'bottle', unitBn: 'বোতল',
    weightGrams: 720, images: [img('sundarbans-honey')], thumbnail: img('sundarbans-honey'), supplierId: 'sup-sundarban', vendorId: 'sup-sundarban',
    vendorName: 'Sundarban Forest Honey Co-operative', vendorNameBn: 'সুন্দরবন ফরেস্ট হানি সমবায়', sellingModel: 'VENDOR',
    customAttributes: [
      { key: 'net_weight', label: 'Net Weight', value: 500, unit: 'g', dataType: 'MEASURE', filterable: true },
      { key: 'shelf_life_months', label: 'Shelf Life', value: 24, unit: 'months', dataType: 'NUMBER' },
      { key: 'storage', label: 'Storage', value: 'Room temperature, away from sunlight.', dataType: 'TEXT' },
    ],
    economics: { costPrice: 610, commissionPercent: 14, taxIncludedInPrice: true },
    returnPolicy: { returnable: true, windowDays: 7, restockable: true, conditionRequired: 'Unopened and sealed.' },
    seo: { title: 'Sundarbans Wild Forest Honey 500g', description: 'Raw multi-floral honey from a forest-fringe co-operative. Batch-coded, unfiltered.' },
    isFeatured: true, isNewArrival: true, badge: 'Seasonal', badgeBn: 'মৌসুমি',
  }),

  base({
    id: 'prod-mango-pickle-handmade',
    title: 'Handmade Green Mango Pickle', titleBn: 'হাতে তৈরি কাঁচা আমের আচার',
    slug: 'handmade-green-mango-pickle', sku: 'KSH-FD-PKL-350',
    shortDescription: 'Small-batch kachri am achar from a home kitchen, 350g.',
    shortDescriptionBn: 'বাড়ির রান্নাঘরে তৈরি কাঁচা আমের আচার, ৩৫০ গ্রাম।',
    description: 'Made by an entrepreneur partner in Jashore in batches of forty jars. Sliced green mango, panch phoron, mustard, chilli and mustard oil; cured for nine days before jarring.',
    descriptionBn: 'ঝিনাইদার উদ্যোক্তা পার্টনার চালিশ বয়ামের ব্যাচে তৈরি করেন। কাঁচা আম, পঁচফোড়ন, সরিষা, মরিচ ও সরিষার তেল—নয় দিন পাকিয়ে বয়ামে ভরা হয়।',
    category: 'Food & Snacks', categorySlug: 'food-snacks', subcategory: 'Pickles & Preserves', subcategorySlug: 'pickles',
    brand: 'Komodpur Kitchen', price: 340, costPrice: 185, stock: 64, lowStockThreshold: 15, unit: 'jar', unitBn: 'বয়াম',
    weightGrams: 480, images: [img('mango-pickle')], thumbnail: img('mango-pickle'), supplierId: 'sup-komodpur', vendorId: 'sup-komodpur',
    vendorName: 'Komodpur Kitchen', vendorNameBn: 'কমলপুর কিচেন', sellingModel: 'VENDOR',
    customAttributes: [
      { key: 'net_weight', label: 'Net Weight', value: 350, unit: 'g', dataType: 'MEASURE', filterable: true },
      { key: 'shelf_life_months', label: 'Shelf Life', value: 6, unit: 'months', dataType: 'NUMBER' },
      { key: 'allergens', label: 'Allergen Advice', value: 'Contains mustard, sesame.', dataType: 'TEXT' },
    ],
    economics: { costPrice: 185, commissionPercent: 12 },
    returnPolicy: { returnable: false, exceptions: 'Homemade food is non-returnable once delivered.', exceptionsBn: 'বাড়িতে তৈরি খাবার ডেলিভারির পর ফেরত যায় না।' },
  }),

  base({
    id: 'prod-dry-cake-handmade',
    title: 'Handmade Dry Cake (Banana & Walnut)', titleBn: 'হাতে তৈরি ড্রাই কেক (কলা ও আখরোট)',
    slug: 'handmade-dry-cake-banana-walnut', sku: 'KSH-FD-CAK-400',
    shortDescription: 'Keeps-for-weeks fruit cake, baked weekly in 400g loaves.',
    shortDescriptionBn: 'সপ্তাহে একবার বেক করা ৪০০ গ্রামের ফল কেক, দীর্ঘদিন থাকে।',
    description: 'A dense, not-too-sweet dry cake with dried banana, walnut and a hint of orange peel. Baked every Tuesday and shipped Wednesday so it is never more than a day old when it leaves the kitchen.',
    descriptionBn: 'শুকনো কলা, আখরোট ও কমলার খোসার হালকা গন্ধে তৈরি ঘন, কম মিষ্টি ড্রাই কেক। প্রতি মঙ্গলবার বেক করা হয় বুধবার পাঠানোর জন্য—তাই কিচেন থেকে বের হওয়ার সময় এক দিনের বেশি পুরোনো হয় না।',
    category: 'Food & Snacks', categorySlug: 'food-snacks', subcategory: 'Bakery', subcategorySlug: 'bakery',
    brand: 'Komodpur Kitchen', price: 380, costPrice: 205, stock: 42, lowStockThreshold: 12, unit: 'piece', unitBn: 'পিস',
    weightGrams: 430, images: [img('dry-cake')], thumbnail: img('dry-cake'), supplierId: 'sup-komodpur', vendorId: 'sup-komodpur', vendorName: 'Komodpur Kitchen', sellingModel: 'VENDOR',
    customAttributes: [
      { key: 'net_weight', label: 'Net Weight', value: 400, unit: 'g', dataType: 'MEASURE' },
      { key: 'shelf_life_months', label: 'Shelf Life', value: 1, unit: 'months', dataType: 'NUMBER' },
    ],
    economics: { costPrice: 205, commissionPercent: 12 },
    returnPolicy: { returnable: false, exceptions: 'Bakery items are non-returnable.', exceptionsBn: 'বেকরি পণ্য ফেরত দেওয়া যায় না।' },
    procurement: { batchTracked: true, storageLocation: 'JHR-K1', supplierLeadTimeDays: 2 },
  }),

  base({
    id: 'prod-biscuits-munna',
    title: 'Traditional Munna Biscuits (1kg)', titleBn: 'ঐতিহ্যবাহী মুন্না বিস্কুট (১ কেজি)',
    slug: 'traditional-munna-biscuits-1kg', sku: 'KSH-FD-BIS-1K',
    shortDescription: 'Crumbly tea-time munna biscuits in a reusable tin.',
    shortDescriptionBn: 'চায়ের সঙ্গে খাওয়া ভেঙে যাওয়া মুন্না বিস্কুট, রিইউজেবল টিনে।',
    description: 'A 1kg tin of the classic Bangladeshi munna biscuit — ghee-forward, low sugar, baked by a 30-year-old family bakery in old Dhaka. Ships in a cushioned carton to keep breakage down.',
    descriptionBn: 'পুরান ঢাকার ৩০ বছরের পুরোনো পারিবারিক বেকারিতে তৈরি ১ কেজি টিনে ক্লাসিক মুন্না বিস্কুট—ঘি-ভাব, কম চিনি। ভাঙন কমাতে ফোম কার্টনে পাঠানো হয়।',
    category: 'Food & Snacks', categorySlug: 'food-snacks', subcategory: 'Biscuits', subcategorySlug: 'biscuits',
    brand: 'Puran Dhaka Bakery', price: 520, originalPrice: 580, costPrice: 330, stock: 240, lowStockThreshold: 40, unit: 'tin', unitBn: 'টিন',
    weightGrams: 1150, images: [img('munna-biscuits')], thumbnail: img('munna-biscuits'),
    customAttributes: [
      { key: 'net_weight', label: 'Net Weight', value: 1000, unit: 'g', dataType: 'MEASURE', filterable: true },
      { key: 'shelf_life_months', label: 'Shelf Life', value: 4, unit: 'months', dataType: 'NUMBER' },
      { key: 'allergens', label: 'Allergen Advice', value: 'Wheat, dairy, egg.', dataType: 'TEXT' },
    ],
    returnPolicy: { returnable: false, exceptions: 'Food item.', exceptionsBn: 'খাদ্য পণ্য।' },
    isBestseller: true,
  }),

  base({
    id: 'prod-tea-chandranath',
    title: 'Sylhet Chandranath Green Tea 200g', titleBn: 'সিলেট চন্দ্রনাত গ্রিন টি ২০০ গ্রাম',
    slug: 'sylhet-chandranath-green-tea-200g', sku: 'KSH-FD-TEA-200',
    shortDescription: 'Single-estate green tea, two-leaf-and-bud, light astringency.',
    shortDescriptionBn: 'এক-বাগানের গ্রিন টি, দুই পাতা ও কুঁড়ি, হালকা তেতো ভাব।',
    description: 'Picked at the Chandranath estate and processed within six hours. Packed in a foil-lined, valve-sealed pouch so the aroma survives the trip to Dhaka.',
    descriptionBn: 'চন্দ্রনাত বাগানে তোলা এবং ছয় ঘণ্টার মধ্যে প্রসেস করা। পাতার ঘ্রাণ ঢাকা পর্যন্ত থাকে বলে ফয়েল-লাইন ভ্যালভ-সিল পচে প্যাক করা হয়।',
    category: 'Food & Snacks', categorySlug: 'food-snacks', subcategory: 'Tea & Coffee', subcategorySlug: 'tea-coffee',
    brand: 'Chandranath Estate', price: 640, costPrice: 400, stock: 118, lowStockThreshold: 25, unit: 'pack', unitBn: 'প্যাকেট',
    weightGrams: 230, images: [img('green-tea')], thumbnail: img('green-tea'),
    customAttributes: [
      { key: 'net_weight', label: 'Net Weight', value: 200, unit: 'g', dataType: 'MEASURE' },
      { key: 'shelf_life_months', label: 'Shelf Life', value: 18, unit: 'months', dataType: 'NUMBER' },
    ],
    variants: [
      { id: 'var-100', name: '100g pouch', sku: 'KSH-FD-TEA-100', price: 340, stock: 90, attributes: { size: '100g' } },
      { id: 'var-200', name: '200g pouch', sku: 'KSH-FD-TEA-200', price: 640, stock: 118, attributes: { size: '200g' } },
      { id: 'var-500', name: '500g tin', sku: 'KSH-FD-TEA-500', price: 1480, stock: 32, attributes: { size: '500g' } },
    ],
    returnPolicy: { returnable: true, windowDays: 7, restockable: true, conditionRequired: 'Unopened pouch.' },
  }),

  base({
    id: 'prod-coffee-bundle',
    title: 'Cold Brew Coffee Starter Bundle', titleBn: 'কোল্ড ব্রু কফি স্টার্টার বান্ডেল',
    slug: 'cold-brew-coffee-starter-bundle', sku: 'KSH-FD-COF-BDL',
    shortDescription: '500g medium-dark grounds, a 1L carafe and a filter.',
    shortDescriptionBn: '৫০০ গ্রাম মিডিয়াম-ডার্ক গ্রাউন্ড, ১ লিটার কারাফ ও ফিল্টার।',
    description: 'Everything needed to brew cold coffee overnight: single-origin S1795-grade grounds, a borosilicate carafe with a wooden collar, and a reusable mesh filter. Roasted to order on Mondays.',
    descriptionBn: 'রাতভর কোল্ড কফি বানাতে যা দরকার সব: সিঙ্গেল অরিজিন মিডিয়াম-ডার্ক গ্রাউন্ড, কাঠের কলারসহ বোরোসিলিকেট কারাফ এবং রিইউজেবল মেশ ফিল্টার। সোমবার অর্ডারে রোস্ট করা হয়।',
    category: 'Food & Snacks', categorySlug: 'food-snacks', subcategory: 'Tea & Coffee', subcategorySlug: 'tea-coffee',
    brand: 'KISHOLOY Kitchen', price: 1850, originalPrice: 2100, costPrice: 1220, stock: 28, lowStockThreshold: 8, unit: 'bundle', unitBn: 'বান্ডেল',
    weightGrams: 1600, images: [img('coffee-bundle')], thumbnail: img('coffee-bundle'), productType: 'BUNDLE',
    customAttributes: [
      { key: 'net_weight', label: 'Coffee Weight', value: 500, unit: 'g', dataType: 'MEASURE' },
      { key: 'includes', label: 'Inside the Box', value: '500g grounds, 1L carafe, mesh filter, recipe card', dataType: 'TEXT' },
    ],
    specifications: [{ group: 'Bundle Contents', values: [
      { key: 'coffee', label: 'Grounds', value: '500 g medium-dark', dataType: 'TEXT' },
      { key: 'carafe', label: 'Carafe', value: '1 L borosilicate', dataType: 'TEXT' },
      { key: 'filter', label: 'Filter', value: 'Reusable stainless mesh', dataType: 'TEXT' },
    ] }],
    returnPolicy: { returnable: true, windowDays: 7, restockable: true, conditionRequired: 'Coffee bag must be unopened.' },
    isNewArrival: true,
  }),

  base({
    id: 'prod-dry-snacks-mixture',
    title: 'Mixed Dry Snack Jhal 400g', titleBn: 'মিক্সড ড্রাই স্ন্যাকস ঝাল ৪০০ গ্রাম',
    slug: 'mixed-dry-snack-jhal-400g', sku: 'KSH-FD-SNK-400',
    shortDescription: 'Chira, mudiman, puffed rice and peanuts in a dry chilli mix.',
    shortDescriptionBn: 'চিড়া, মুড়ি, মুড়কি ও চিনাবাদাম শুকনো মশলায়।',
    description: 'The Dhaka-school version: barely oily, very crunchy, moderate heat. Eaten dry, on rice, or with tea.',
    descriptionBn: 'ঢাকার স্টাইল—তেল কম, কড়কড়ে, মাঝারি ঝাল। শুকনো, ভাতের সঙ্গে বা চায়ের পাশে খাওয়া যায়।',
    category: 'Food & Snacks', categorySlug: 'food-snacks', subcategory: 'Dry Snacks', subcategorySlug: 'dry-snacks',
    brand: 'KISHOLOY Kitchen', price: 290, costPrice: 168, stock: 0, lowStockThreshold: 20, unit: 'pack', unitBn: 'প্যাকেট',
    weightGrams: 430, images: [img('dry-snacks')], thumbnail: img('dry-snacks'),
    customAttributes: [
      { key: 'net_weight', label: 'Net Weight', value: 400, unit: 'g', dataType: 'MEASURE' },
      { key: 'shelf_life_months', label: 'Shelf Life', value: 3, unit: 'months', dataType: 'NUMBER' },
    ],
    returnPolicy: { returnable: false, exceptions: 'Food item.', exceptionsBn: 'খাদ্য পণ্য।' },
  }),

  // ── GROCERY ───────────────────────────────────────────────────────────────
  base({
    id: 'prod-chinigura-rice',
    title: 'Chinigura Miniket Rice 5kg', titleBn: 'চিনিগুড়া মিনিকেট চাল ৫ কেজি',
    slug: 'chinigura-miniket-rice-5kg', sku: 'KSH-GR-RIC-5K',
    shortDescription: 'Aged 12 months, hand-sorted, for biryani and plain rice.',
    shortDescriptionBn: '১২ মাস পুরোনো, হাতে ছাঁটাই—পোলাও ও সাদা ভাতের জন্য।',
    description: 'Sourced from a Dinajpur miller and aged a full season before milling so the grains stay separate. Vacuum-packed in 5kg bricks.',
    descriptionBn: 'দিনাজপুরের মিল থেকে নিয়ে এক ঋতু পুরোনো করে ভাঙানো হয়, তাই দানা আলাদা থাকে। ৫ কেজি ভ্যাকুয়াম ব্রিকে প্যাক।',
    category: 'Grocery & Pantry', categorySlug: 'grocery', subcategory: 'Rice & Grains', subcategorySlug: 'rice',
    brand: 'Dinajpur Mills', price: 760, originalPrice: 840, costPrice: 615, stock: 320, lowStockThreshold: 60, unit: 'bag', unitBn: 'বস্তা',
    weightGrams: 5100, images: [img('rice-5kg')], thumbnail: img('rice-5kg'),
    customAttributes: [
      { key: 'net_weight', label: 'Net Weight', value: 5, unit: 'kg', dataType: 'MEASURE', filterable: true },
      { key: 'grade', label: 'Grade', value: 'Premium', dataType: 'SELECT', filterable: true },
    ],
    variants: [
      { id: 'var-2k', name: '2 kg', sku: 'KSH-GR-RIC-2K', price: 320, stock: 210 },
      { id: 'var-5k', name: '5 kg', sku: 'KSH-GR-RIC-5K', price: 760, stock: 320 },
    ],
    returnPolicy: { returnable: true, windowDays: 3, restockable: true, conditionRequired: 'Sealed bag only.' },
    isBestseller: true,
  }),

  base({
    id: 'prod-mustard-oil-pressed',
    title: 'Cold-Pressed Mustard Oil 1L', titleBn: 'ঘানিভাঙা সরিষার তেল ১ লিটার',
    slug: 'cold-pressed-mustard-oil-1l', sku: 'KSH-GR-OIL-1L',
    shortDescription: 'Single-pressed, unrefined, strong pang. No blending.',
    shortDescriptionBn: 'একবার ঘানিতে ভাঙা, রিফাইন নয়, তীক্ষ্ণ ঝাঁজ। মিশ্রণ নেই।',
    description: 'Pressed in a traditional ghani at below 40°C and rested ten days before bottling, so the sediment settles naturally. Bottled in amber glass to protect it from light.',
    descriptionBn: 'ঐতিহ্যবাহী ঘানিতে ৪০° সে.-এর নিচে ভেঙে দশ দিন রেখে বোতলজাত করা হয়, তাই তলানি নিজে থেকেই বসে যায়। আলো থেকে রক্ষায় অ্যাম্বার কাচের বোতল।',
    category: 'Grocery & Pantry', categorySlug: 'grocery', subcategory: 'Oils', subcategorySlug: 'oils',
    brand: 'Barisal Ghani', price: 430, costPrice: 300, stock: 148, lowStockThreshold: 30, unit: 'bottle', unitBn: 'বোতল',
    weightGrams: 1050, images: [img('mustard-oil')], thumbnail: img('mustard-oil'),
    customAttributes: [
      { key: 'net_weight', label: 'Volume', value: 1000, unit: 'ml', dataType: 'MEASURE' },
      { key: 'grade', label: 'Grade', value: 'Premium', dataType: 'SELECT', filterable: true },
    ],
    returnPolicy: { returnable: true, windowDays: 7, restockable: true, conditionRequired: 'Unopened.' },
    procurement: { reorderPoint: 50, reorderQuantity: 200, storageLocation: 'DHK-B2' },
  }),

  // ── HANDMADE / ARTISAN (vendor, made to order) ────────────────────────────
  base({
    id: 'prod-jute-table-runner',
    title: 'Handloom Jute Table Runner', titleBn: 'হাতে বোনা পাটের টেবিল রানার',
    slug: 'handloom-jute-table-runner', sku: 'KSH-HM-JUT-RNR',
    shortDescription: 'Woven on a pit loom in Rangamati; each piece differs slightly.',
    shortDescriptionBn: 'রাঙ্গামাটির পিট লুমে বোনা; প্রতিটি টুকরো সামান্য আলাদা।',
    description: 'Undyed jute with a hand-knotted fringe, 40 × 160 cm. Because it is woven to order, allow five to seven days before dispatch. Small irregularities in the weave are the maker’s signature, not a defect.',
    descriptionBn: 'রংবিহীন পাটে হাতে বাঁধা ফ্রিঞ্জসহ ৪০ × ১৬০ সে.মি.। অর্ডারে বোনা হয় বলে পাঠাতে ৫–৭ দিন লাগে। বোনার ছোট ছোট অনিয়মিততা কারিগরের স্বাক্ষর, ত্রুটি নয়।',
    category: 'Handmade & Artisan', categorySlug: 'handmade', subcategory: 'Textiles', subcategorySlug: 'textiles',
    brand: 'Nakra Craft Collective', price: 1250, costPrice: 700, stock: 18, lowStockThreshold: 5, unit: 'piece', unitBn: 'পিস',
    weightGrams: 400, dimensions: { length: 160, width: 40, unit: 'cm' },
    images: [img('jute-runner')], thumbnail: img('jute-runner'), supplierId: 'sup-nakra', vendorId: 'sup-nakra', vendorName: 'Nakra Craft Collective',
    sellingModel: 'MADE_TO_ORDER',
    customAttributes: [
      { key: 'material', label: 'Material', value: 'Undyed jute', dataType: 'TEXT', filterable: true },
      { key: 'maker_region', label: 'Maker Region', value: 'Rangamati', dataType: 'TEXT', filterable: true },
      { key: 'made_to_order', label: 'Made to Order', value: true, dataType: 'BOOLEAN' },
    ],
    economics: { costPrice: 700, commissionPercent: 18 },
    returnPolicy: { returnable: false, exceptions: 'Made-to-order craft pieces are non-returnable unless damaged in transit.', exceptionsBn: 'অর্ডারে তৈরি পণ্য পাঠে ক্ষতি না হলে ফেরত যায় না।' },
    procurement: { supplierLeadTimeDays: 7, minOrderQuantity: 1 },
    isNewArrival: true,
  }),

  base({
    id: 'prod-terracotta-mug-set',
    title: 'Terracotta Tea Mug — Set of 2', titleBn: 'মাটির চায়ের মগ — ২ পিস',
    slug: 'tercotta-tea-mug-set-of-2', sku: 'KSH-HM-CLAY-MUG2',
    shortDescription: 'Wheel-thrown in Pabna, food-safe glaze, dishwasher hesitant.',
    shortDescriptionBn: 'পাবনায় চাকায় তোলা, ফুড-সেফ গ্লেজ, ডিশওয়াশার এড়িয়ে চলুন।',
    description: 'Unglazed exterior, glazed interior, 260 ml each. Fired twice. Slight size variation is normal with clay. Ships in a moulded pulp insert tested to a one-metre drop.',
    descriptionBn: 'বাইরে আনগ্লেজড, ভেতরে গ্লেজড, প্রতিটি ২৬০ মি.লি.। দুইবার পোড়া। মাটিতে সামান্য আলাদা মাপ স্বাভাবিক। মোল্ডেড পাল্প ইনসার্টে (১ মিটার থেকে ড্রপ-টেস্টেড) পাঠানো হয়।',
    category: 'Handmade & Artisan', categorySlug: 'handmade', subcategory: 'Ceramics', subcategorySlug: 'ceramics',
    brand: 'Nakra Craft Collective', price: 980, originalPrice: 1150, costPrice: 520, stock: 36, lowStockThreshold: 10, unit: 'set', unitBn: 'সেট',
    weightGrams: 900, images: [img('terracotta-mugs')], thumbnail: img('terracotta-mugs'), supplierId: 'sup-nakra', vendorId: 'sup-nakra', vendorName: 'Nakra Craft Collective', sellingModel: 'VENDOR',
    customAttributes: [
      { key: 'material', label: 'Material', value: 'Red earthenware', dataType: 'TEXT', filterable: true },
      { key: 'capacity_ml', label: 'Capacity', value: 260, unit: 'ml', dataType: 'MEASURE' },
    ],
    economics: { costPrice: 520, commissionPercent: 16 },
    returnPolicy: { returnable: true, windowDays: 7, restockable: false, conditionRequired: 'Returnable only if damaged or mis-shipped; fragile items are not restocked.' },
    isFeatured: true,
  }),

  // ── HOME & KITCHEN (in-house) ─────────────────────────────────────────────
  base({
    id: 'prod-stainless-tiffin',
    title: '3-Tier Stainless Steel Tiffin Box', titleBn: '৩-স্তর স্টেইনলেস টিফিন বক্স',
    slug: '3-tier-stainless-tiffin-box', sku: 'KSH-HK-TIF-3T',
    shortDescription: '18/8 steel, leak-resistant lids, 1.4 L total.',
    shortDescriptionBn: '১৮/৮ স্টিল, লিক-রেজিস্ট্যান্ট ঢাকনা, মোট ১.৪ লিটার।',
    description: 'Built for office lunches and school tiffins: three 450 ml compartments, a carrying bag, and a handle that does not heat up. Not for the microwave.',
    descriptionBn: 'অফিস বা স্কুলের লাঞ্চের জন্য: তিনটি ৪৫০ মি.লি. কম্পার্টমেন্ট, ব্যাগ, গরম না হওয়া হাতল। মাইক্রোওয়েভে দেবেন না।',
    category: 'Home & Kitchen', categorySlug: 'home-kitchen', subcategory: 'Lunch & Storage', subcategorySlug: 'storage',
    brand: 'KISHOLOY Home', price: 1450, originalPrice: 1690, costPrice: 940, stock: 84, lowStockThreshold: 20, unit: 'piece', unitBn: 'পিস',
    weightGrams: 1200, images: [img('tiffin-box')], thumbnail: img('tiffin-box'),
    customAttributes: [
      { key: 'material', label: 'Material', value: '18/8 stainless steel', dataType: 'TEXT', filterable: true },
      { key: 'capacity_ml', label: 'Total Capacity', value: 1400, unit: 'ml', dataType: 'MEASURE' },
      { key: 'dishwasher_safe', label: 'Dishwasher Safe', value: true, dataType: 'BOOLEAN' },
    ],
    warranty: { applicable: true, durationMonths: 6, provider: 'KISHOLOY', summary: 'Covers manufacturing defects in the body and lids.' },
    returnPolicy: { returnable: true, windowDays: 14, restockable: true },
    isBestseller: true,
  }),

  base({
    id: 'prod-cotton-bedsheet',
    title: 'Hand Block-Printed Cotton Bedsheet (Double)', titleBn: 'হাতে ছাপা কাপনের বডশিট (ডাবল)',
    slug: 'hand-block-printed-cotton-bedsheet-double', sku: 'KSH-HK-BED-DBL',
    shortDescription: 'Natural dye, block printed in Dhakaiya style, 245 × 225 cm.',
    shortDescriptionBn: 'প্রাকৃতিক রঙ, ঢাকাইয়ান স্টাইলে ব্লক প্রিন্ট, ২৪৫ × ২২৫ সে.মি.।',
    description: 'Washed twice before sale so the first laundry does not surprise you. Includes two matching pillow covers.',
    descriptionBn: 'বিক্রির আগে দুবার ধোয়া, তাই প্রথম ওয়াশে আকস্মিক সংকোচন হয় না। মিলিয়ে দুটি বালিশকভারসহ।',
    category: 'Home & Kitchen', categorySlug: 'home-kitchen', subcategory: 'Bedding', subcategorySlug: 'bedding',
    brand: 'KISHOLOY Home', price: 2350, costPrice: 1480, stock: 41, lowStockThreshold: 12, unit: 'set', unitBn: 'সেট',
    weightGrams: 1400, images: [img('bedsheet')], thumbnail: img('bedsheet'),
    customAttributes: [
      { key: 'material', label: 'Material', value: '100% cotton, 144 TC', dataType: 'TEXT', filterable: true },
      { key: 'dimensions_cm', label: 'Dimensions', value: '245 × 225 cm', dataType: 'TEXT' },
    ],
    returnPolicy: { returnable: true, windowDays: 10, restockable: true, conditionRequired: 'Unwashed, original packaging.' },
  }),

  // ── BEAUTY / PERSONAL CARE ────────────────────────────────────────────────
  base({
    id: 'prod-neem-soap',
    title: 'Neem & Tea Tree Handmade Soap', titleBn: 'নিম ও টি-ট্রি হাতে তৈরি সাবান',
    slug: 'neem-tea-tree-handmade-soap', sku: 'KSH-BC-SAP-NEEM',
    shortDescription: 'Cold-process, 4-week cure, for oily and acne-prone skin.',
    shortDescriptionBn: 'কোল্ড প্রসেস, ৪ সপ্তাহ কিউর, তৈলাক্ত ও ব্রণপ্রবণ ত্বকের জন্য।',
    description: 'Castor, coconut and rice-bran oils saponified cold, with 2% superfat and neem leaf. Each bar is stamped with its cure date.',
    descriptionBn: 'এরান্ডি, নারকেল ও চালকুটমির তেল কোল্ড প্রসেসে সাবান করা হয়, ২% সুপারফ্যাট ও নিম পাতাসহ। প্রতিটি সাবানে কিউরের তারিখ মোহর থাকে।',
    category: 'Beauty & Personal Care', categorySlug: 'beauty-personal-care', subcategory: 'Bath & Body', subcategorySlug: 'bath-body',
    brand: 'KISHOLOY Care', price: 240, costPrice: 118, stock: 260, lowStockThreshold: 40, unit: 'bar', unitBn: 'পিস',
    weightGrams: 110, images: [img('neem-soap')], thumbnail: img('neem-soap'),
    customAttributes: [
      { key: 'volume_ml', label: 'Weight', value: 100, unit: 'g', dataType: 'MEASURE' },
      { key: 'skin_type', label: 'Suitable Skin Type', value: 'Oily', dataType: 'SELECT', filterable: true },
    ],
    returnPolicy: { returnable: false, exceptions: 'Opened personal-care items cannot be returned for hygiene reasons.', exceptionsBn: 'খোলা ব্যক্তিগত যত্নের পণ্য স্বাস্থ্যবিধির কারণে ফেরত যায় না।' },
  }),

  base({
    id: 'prod-hair-oil-herbal',
    title: 'Herbal Hair Oil — Bhringraj 200ml', titleBn: 'হারবাল হেয়ার অয়েল (ভৃংরাজ) ২০০ মি.লি.',
    slug: 'herbal-hair-oil-bhringraj-200ml', sku: 'KSH-BC-HAI-200',
    shortDescription: 'Infused 21 days in sesame with bhringraj and amla.',
    shortDescriptionBn: 'তিলে ২১ দিন ভিজিয়ে ভৃংরাজ ও আমলাসহ তৈরি।',
    description: 'A slow infusion, not a fragrance blend: sesame base with bhringraj, amla and fenugreek, strained twice and bottled dark. For dry scalps and postpartum hair fall.',
    descriptionBn: 'ঘ্রাণ মেশানো তেল নয়—ধীরে তৈরি ইনফিউশন: তিলের তলে ভৃংরাজ, আমলা ও মেথি, দুবার ছেঁকে কালো বোতলে। শুষ্ক খোপড়ি ও প্রসবোত্তর চুল পড়ার জন্য।',
    category: 'Beauty & Personal Care', categorySlug: 'beauty-personal-care', subcategory: 'Hair Care', subcategorySlug: 'hair-care',
    brand: 'KISHOLOY Care', price: 390, costPrice: 190, stock: 132, lowStockThreshold: 25, unit: 'bottle', unitBn: 'বোতল',
    weightGrams: 260, images: [img('hair-oil')], thumbnail: img('hair-oil'),
    customAttributes: [
      { key: 'volume_ml', label: 'Volume', value: 200, unit: 'ml', dataType: 'MEASURE' },
      { key: 'skin_type', label: 'Suitable For', value: 'Dry scalp', dataType: 'SELECT', filterable: true },
    ],
    returnPolicy: { returnable: false, exceptions: 'Opened personal-care items cannot be returned.', exceptionsBn: 'খোলা যত্নের পণ্য ফেরত যায় না।' },
  }),

  // ── GIFTS & HAMPERS ───────────────────────────────────────────────────────
  base({
    id: 'prod-gratitude-hamper',
    title: 'Kisholoy Gratitude Hamper (12 Items)', titleBn: 'কিশলয় কৃতজ্ঞতা হ্যাম্পার (১২ পিস)',
    slug: 'kisholoy-gratitude-hamper', sku: 'KSH-GF-HMP-12',
    shortDescription: 'Curated box of Bangladeshi pantry and craft, hand-packed.',
    shortDescriptionBn: 'বাংলাদেশি খাবার ও হস্তশিল্পের সাজানো বক্স, হাতে প্যাক করা।',
    description: 'Assembled to order: chui jhal, Sundarbans honey, biscuits, dry cake, a terracotta mug, a jute runner, soap and a handwritten card. Choose sweet-forward, savoury-forward or balanced.',
    descriptionBn: 'অর্ডারে সাজানো: চুই ঝাল, সুন্দরবনের মধু, বিস্কুট, ড্রাই কেক, মাটির মগ, পাটের রানার, সাবান ও হাতে লেখা কার্ড। মিষ্টিপ্রধান, ঝালপ্রধান বা ভুলানো—যেকোনোটি বাছা যায়।',
    category: 'Gifts & Hampers', categorySlug: 'gifts', subcategory: 'Hampers', subcategorySlug: 'hampers',
    brand: 'KISHOLOY Gifting', price: 3450, originalPrice: 3900, costPrice: 2280, stock: 22, lowStockThreshold: 6, unit: 'box', unitBn: 'বক্স',
    weightGrams: 3200, images: [img('gratitude-hamper')], thumbnail: img('gratitude-hamper'), productType: 'BUNDLE', sellingModel: 'MADE_TO_ORDER',
    customAttributes: [
      { key: 'occasion', label: 'Occasion', value: ['Gratitude', 'Corporate', 'Wedding'], dataType: 'MULTI_SELECT', filterable: true },
      { key: 'includes', label: 'Inside the Box', value: '12 curated items, card, jute ribbon', dataType: 'TEXT' },
    ],
    specifications: [{ group: 'Composition', values: [
      { key: 'food', label: 'Food items', value: 7, unit: 'pcs', dataType: 'NUMBER' },
      { key: 'craft', label: 'Craft items', value: 3, unit: 'pcs', dataType: 'NUMBER' },
      { key: 'care', label: 'Personal care', value: 2, unit: 'pcs', dataType: 'NUMBER' },
    ] }],
    variants: [
      { id: 'var-bal', name: 'Balanced mix', sku: 'KSH-GF-HMP-BAL', price: 3450, stock: 10 },
      { id: 'var-sweet', name: 'Sweet forward', sku: 'KSH-GF-HMP-SWT', price: 3350, stock: 6 },
      { id: 'var-sav', name: 'Savoury forward', sku: 'KSH-GF-HMP-SAV', price: 3550, stock: 6 },
    ],
    returnPolicy: { returnable: false, exceptions: 'Assembled hampers are non-returnable once packed.', exceptionsBn: 'প্যাক করার পর হ্যাম্পার ফেরত যায় না।' },
    procurement: { supplierLeadTimeDays: 2, batchTracked: false },
    isFeatured: true, isNewArrival: true,
  }),

  // ── APPAREL (vendor) ──────────────────────────────────────────────────────
  base({
    id: 'prod-katan-panjabi',
    title: 'Hand-Finished Katan Panjabi', titleBn: 'হাতে সাজানো কাটান পাঞ্জাবি',
    slug: 'hand-finished-katan-panjabi', sku: 'KSH-AP-PNJ-KAT',
    shortDescription: 'Embroidered placket, 100% cotton-silk, sizes S–XXL.',
    shortDescriptionBn: 'হাতে কশিদার কলার, ১০০% কটন-সিল্ক, সাইজ S–XXL।',
    description: 'Cut and stitched by a four-person workshop in Narayanganj; the thread work on the placket is done by hand, so allow an extra day before dispatch during Eid season.',
    descriptionBn: 'নারায়ণগঞ্জের চারজনের কারখানায় কাটা ও সেলাই; কলারের কাজ হাতে হয়, তাই ঈদের সময় এক দিন অতিরিক্ত সময় রাখুন।',
    category: 'Apparel & Accessories', categorySlug: 'apparel', subcategory: "Men's Wear", subcategorySlug: 'mens-wear',
    brand: 'Narayanganj Atelier', price: 2750, originalPrice: 3200, costPrice: 1690, stock: 54, lowStockThreshold: 10, unit: 'piece', unitBn: 'পিস',
    weightGrams: 620, images: [img('katan-panjabi')], thumbnail: img('katan-panjabi'),
    supplierId: 'sup-nakra', vendorId: 'sup-nakra', vendorName: 'Narayanganj Atelier', sellingModel: 'VENDOR',
    variants: [
      { id: 'var-s', name: 'Size S', sku: 'KSH-AP-PNJ-S', price: 2750, stock: 8, attributes: { size: 'S' } },
      { id: 'var-m', name: 'Size M', sku: 'KSH-AP-PNJ-M', price: 2750, stock: 16, attributes: { size: 'M' } },
      { id: 'var-l', name: 'Size L', sku: 'KSH-AP-PNJ-L', price: 2750, stock: 14, attributes: { size: 'L' } },
      { id: 'var-xl', name: 'Size XL', sku: 'KSH-AP-PNJ-XL', price: 2850, stock: 10, attributes: { size: 'XL' } },
      { id: 'var-xxl', name: 'Size XXL', sku: 'KSH-AP-PNJ-XXL', price: 2950, stock: 6, attributes: { size: 'XXL' } },
    ],
    customAttributes: [
      { key: 'fabric', label: 'Fabric', value: 'Cotton-silk katan', dataType: 'TEXT', filterable: true },
      { key: 'size_range', label: 'Sizes', value: ['S', 'M', 'L', 'XL', 'XXL'], dataType: 'MULTI_SELECT', filterable: true },
      { key: 'care', label: 'Care', value: 'Dry clean recommended', dataType: 'TEXT' },
    ],
    economics: { costPrice: 1690, commissionPercent: 15 },
    returnPolicy: { returnable: true, windowDays: 7, restockable: true, conditionRequired: 'Unworn, tags on. No size exchanges after Eid.' },
    isBestseller: true,
  }),

  // ── ELECTRONICS ACCESSORY (in-house, warranty) ────────────────────────────
  base({
    id: 'prod-fast-charger',
    title: '20W USB-C Fast Charger + 1.5m Cable', titleBn: '২০W ইউএসবি-সি ফাস্ট চার্জার + ১.৫ মি. কেবল',
    slug: '20w-usbc-fast-charger-cable', sku: 'KSH-EL-CHG-20W',
    shortDescription: 'PD 3.0, certified for BD voltage swings, 6-month warranty.',
    shortDescriptionBn: 'PD 3.0, বাংলাদেশের ভোল্টেজ ওঠানামার জন্য উপযুক্ত, ৬ মাস ওয়ারন্টি।',
    description: 'Tested on 220–240 V with the load dips common in Dhaka. Ships with a 1.5 m braided cable; boxed individually with the import certification card.',
    descriptionBn: 'ঢাকায় প্রচলিত ২২০–২৪০ ভোল্ট ও লোড ডিপে পরীক্ষিত। ১.৫ মি. ব্রেইডেড কেবলসহ, ইমপোর্ট সার্টিফিকেশন কার্ডসহ প্যাক।',
    category: 'Electronics & Accessories', categorySlug: 'electronics', subcategory: 'Power', subcategorySlug: 'power',
    brand: 'KISHOLOY Tech', price: 1150, originalPrice: 1350, costPrice: 720, stock: 96, lowStockThreshold: 24, unit: 'set', unitBn: 'সেট',
    weightGrams: 180, images: [img('fast-charger')], thumbnail: img('fast-charger'),
    customAttributes: [
      { key: 'warranty_months', label: 'Warranty', value: 6, unit: 'months', dataType: 'NUMBER', filterable: true },
      { key: 'output', label: 'Output', value: '20 W USB-PD 3.0', dataType: 'TEXT' },
      { key: 'compatibility', label: 'Compatibility', value: 'USB-C phones, tablets, earbuds', dataType: 'TEXT' },
    ],
    warranty: { applicable: true, durationMonths: 6, provider: 'KISHOLOY Service Desk', summary: 'Replacement for defects; physical damage excluded.' },
    returnPolicy: { returnable: true, windowDays: 7, restockable: true, conditionRequired: 'Complete box with certification card.' },
  }),

  // ── STATIONERY (vendor) ───────────────────────────────────────────────────
  base({
    id: 'prod-khutki-journal',
    title: 'Hand-Bound Khutki Journal (A5)', titleBn: 'হাতে বাঁধা খুঁটি জার্নাল (A5)',
    slug: 'hand-bound-khutki-journal-a5', sku: 'KSH-ST-JRN-A5',
    shortDescription: 'Stitched spine, 120 gsm handmade paper, 160 pages.',
    shortDescriptionBn: 'সূচি দিয়ে সেলাই, ১২০ জিএসএম হাতে তৈরি কাগজ, ১৬০ পাতা।',
    description: 'Bound with the traditional khutki stitch in Rajshahi. The paper has a tooth that fountain pens like; it will not ghost through badly.',
    descriptionBn: 'রাজশাহীর ঐতিহ্যবাহী খুঁটি সেলাইয়ে বাঁধা। কাগজে এমন টেক্সচার আছে যা ফাউন্টেন পেন পছন্দ করে, পেছনে চুয়াঁচে না।',
    category: 'Stationery & Office', categorySlug: 'stationery', subcategory: 'Notebooks', subcategorySlug: 'notebooks',
    brand: 'Nakra Craft Collective', price: 620, costPrice: 330, stock: 74, lowStockThreshold: 15, unit: 'piece', unitBn: 'পিস',
    weightGrams: 420, images: [img('khutki-journal')], thumbnail: img('khutki-journal'),
    supplierId: 'sup-nakra', vendorId: 'sup-nakra', vendorName: 'Nakra Craft Collective', sellingModel: 'VENDOR',
    customAttributes: [
      { key: 'pages', label: 'Pages', value: 160, dataType: 'NUMBER' },
      { key: 'paper_gsm', label: 'Paper GSM', value: 120, dataType: 'NUMBER' },
    ],
    economics: { costPrice: 330, commissionPercent: 18 },
    returnPolicy: { returnable: true, windowDays: 7, restockable: true },
  }),

  // ── LIFESTYLE & DECOR (vendor) ────────────────────────────────────────────
  base({
    id: 'prod-nagro-basket',
    title: 'Nagro Bamboo Utility Basket (Large)', titleBn: 'নাগরা বাঁশের ইউটিলিটি ঝুড়ি (বড়)',
    slug: 'nagro-bamboo-utility-basket-large', sku: 'KSH-LS-BSK-LGR',
    shortDescription: 'Hand-woven nagro cane, 38 cm, for laundry or storage.',
    shortDescriptionBn: 'হাতে বোনা নাগরা বাঁশ, ৩৮ সে.মি., কাপড় বা সংরক্ষণের জন্য।',
    description: 'Woven in Moulvibazar from treated nagro cane so it resists humidity. Handles are wrapped in jute rope for grip. Dimensions vary a few centimetres between pieces.',
    descriptionBn: 'মৌলভীবাজারে ট্রিটমেন্ট করা নাগরা বাঁশে বোনা, আর্দ্রতা সহ্য করে। হাতল পাটের রশিতে মোড়া। মাপে কয়েক সে.মি. তারতম্য হতে পারে।',
    category: 'Lifestyle & Decor', categorySlug: 'lifestyle', subcategory: 'Storage & Decor', subcategorySlug: 'storage-decor',
    brand: 'Sylhet Cane Works', price: 1480, costPrice: 820, stock: 26, lowStockThreshold: 8, unit: 'piece', unitBn: 'পিস',
    weightGrams: 1600, dimensions: { length: 38, width: 38, height: 30, unit: 'cm' },
    images: [img('nagro-basket')], thumbnail: img('nagro-basket'),
    supplierId: 'sup-nakra', vendorId: 'sup-nakra', vendorName: 'Sylhet Cane Works', sellingModel: 'VENDOR',
    customAttributes: [
      { key: 'material', label: 'Material', value: 'Treated nagro bamboo', dataType: 'TEXT', filterable: true },
      { key: 'dimensions_cm', label: 'Dimensions', value: '38 × 38 × 30 cm', dataType: 'TEXT' },
    ],
    economics: { costPrice: 820, commissionPercent: 17 },
    returnPolicy: { returnable: true, windowDays: 10, restockable: true, conditionRequired: 'Undamaged, original wrap.' },
  }),

  // ── GENERAL RETAIL / HOUSEHOLD (in-house) ─────────────────────────────────
  base({
    id: 'prod-steel-water-bottle',
    title: 'Insulated Steel Water Bottle 1L', titleBn: 'ইনসুলেটেড স্টিল পানির বোতল ১ লিটার',
    slug: 'insulated-steel-water-bottle-1l', sku: 'KSH-HK-BTL-1L',
    shortDescription: '24 h cold / 12 h hot, powder-coated, leakproof cap.',
    shortDescriptionBn: '২৪ ঘণ্টা ঠান্ডা / ১২ ঘণ্টা গরম, পাউডার কোটেড, লিকপ্রুফ ক্যাপ।',
    description: 'Double-wall vacuum bottle that survives a bag drop. Ships with a spare gasket because the lid gasket is the part that eventually leaks.',
    descriptionBn: 'ডাবল-ওয়াল ভ্যাকুয়াম বোতল, ব্যাগে পড়লেও চলে। অতিরিক্ত গ্যাসকেটসহ পাঠানো হয়, কারণ সময়ের সঙ্গে লিক করা অংশটুকু ঢাকনার রবারই হয়।',
    category: 'Home & Kitchen', categorySlug: 'home-kitchen', subcategory: 'Drinkware', subcategorySlug: 'drinkware',
    brand: 'KISHOLOY Home', price: 1290, costPrice: 760, stock: 118, lowStockThreshold: 25, unit: 'piece', unitBn: 'পিস',
    weightGrams: 560, images: [img('steel-bottle')], thumbnail: img('steel-bottle'),
    customAttributes: [
      { key: 'capacity_ml', label: 'Capacity', value: 1000, unit: 'ml', dataType: 'MEASURE', filterable: true },
      { key: 'material', label: 'Material', value: '304 stainless, powder coat', dataType: 'TEXT', filterable: true },
    ],
    variants: [
      { id: 'var-blk', name: 'Charcoal', sku: 'KSH-HK-BTL-1L-BK', price: 1290, stock: 60, attributes: { color: 'Charcoal' } },
      { id: 'var-tel', name: 'Teal', sku: 'KSH-HK-BTL-1L-TE', price: 1290, stock: 40, attributes: { color: 'Teal' } },
      { id: 'var-snd', name: 'Sand', sku: 'KSH-HK-BTL-1L-SA', price: 1290, stock: 18, attributes: { color: 'Sand' } },
    ],
    warranty: { applicable: true, durationMonths: 12, provider: 'KISHOLOY', summary: 'Vacuum integrity only.' },
    returnPolicy: { returnable: true, windowDays: 14, restockable: true },
    isBestseller: true,
  }),
];

/** Coupon set used by the demo store; mirrors real promotion policy. */
export const DEMO_COUPONS: CouponRule[] = [
  {
    id: 'cpn-welcome-150',
    code: 'KISHOLOY150',
    title: 'New customer flat ৳150 off',
    titleBn: 'নতুন ক্রেতার জন্য ১৫০ টাকা ছাড়',
    description: '৳150 off the first order above ৳1,200.',
    descriptionBn: '১,২০০ টাকার উপরে প্রথম অর্ডারে ১৫০ টাকা ছাড়।',
    discountType: 'FIXED_AMOUNT',
    discountValue: 150,
    maxDiscountAmount: 150,
    minOrderSubtotal: 1200,
    startDate: new Date(Date.now() - 45 * 86400_000).toISOString(),
    endDate: new Date(Date.now() + 320 * 86400_000).toISOString(),
    usageLimitTotal: 5000,
    usageCount: 0,
    usageLimitPerCustomer: 1,
    firstOrderOnly: true,
    status: 'ACTIVE',
    totalDiscountDisbursedBdt: 0,
    totalAttributedRevenueBdt: 0,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'cpn-festival-10',
    code: 'UTSHOB10',
    title: 'Festival 10% (capped at ৳600)',
    titleBn: 'উৎসব ১০% (সর্বোচ্চ ৬০০ টাকা)',
    description: '10% across food, gifts and handmade, capped at ৳600.',
    descriptionBn: 'খাবার, উপহার ও হস্তশিল্পে ১০%, সর্বোচ্চ ৬০০ টাকা।',
    discountType: 'PERCENTAGE',
    discountValue: 10,
    maxDiscountAmount: 600,
    minOrderSubtotal: 2000,
    startDate: new Date(Date.now() - 10 * 86400_000).toISOString(),
    endDate: new Date(Date.now() + 90 * 86400_000).toISOString(),
    usageLimitTotal: 1500,
    usageCount: 0,
    usageLimitPerCustomer: 2,
    categoryRestrictions: ['food-snacks', 'gifts', 'handmade'],
    status: 'ACTIVE',
    totalDiscountDisbursedBdt: 0,
    totalAttributedRevenueBdt: 0,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'cpn-freeship',
    code: 'SHOHAGOD',
    title: 'Free delivery over ৳2,500',
    titleBn: '২,৫০০ টাকার উপরে ফ্রি ডেলিভারি',
    description: 'Waives the delivery charge on orders above ৳2,500.',
    descriptionBn: '২,৫০০ টাকার উপরে ডেলিভারি চার্জ মওকুফ।',
    discountType: 'FREE_SHIPPING',
    discountValue: 0,
    minOrderSubtotal: 2500,
    startDate: new Date(Date.now() - 5 * 86400_000).toISOString(),
    endDate: new Date(Date.now() + 180 * 86400_000).toISOString(),
    usageLimitTotal: 3000,
    usageCount: 0,
    usageLimitPerCustomer: 3,
    status: 'ACTIVE',
    totalDiscountDisbursedBdt: 0,
    totalAttributedRevenueBdt: 0,
    createdAt: new Date().toISOString(),
  },
];

/**
 * Demo shoppers. `passwordHash` is intentionally absent: these records exist so
 * analytics and the admin CRM have realistic rows, NOT so someone can log in.
 */
export const DEMO_CUSTOMERS: Array<Partial<Customer> & { name: string; phone: string }> = [
  { name: 'Tanzil Ahmed', phone: '+8801711002211', email: 'tanzil.ahmed@example.com', status: 'ACTIVE', defaultAddress: 'Road 11, Banani, Dhaka', district: 'Dhaka', thana: 'Banani' },
  { name: 'Nusrat Jahan', phone: '+8801812003322', email: 'nusrat.jahan@example.com', status: 'ACTIVE', defaultAddress: 'Holdings 44, Chatiar, Chattogram', district: 'Chattogram', thana: 'Panchlaish' },
  { name: 'Mahmudul Hasan', phone: '+8801913004433', email: '', status: 'ACTIVE', defaultAddress: 'Shibbari, Sylhet', district: 'Sylhet', thana: 'South Shibganj' },
];

/** Number of products the demo catalogue is expected to contain. */
export const DEMO_PRODUCT_COUNT = DEMO_PRODUCTS.length;
