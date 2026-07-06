/**
 * Olive Young-style mega menu taxonomy (full OY parity: 19 groups, 6 columns).
 * Labels are resolved via i18n keys under `categoryMenu.*` so the menu
 * follows the site language. Links use real category filters where a
 * matching product category exists, and canonical English search terms
 * otherwise (product names/tags are English/Japanese, so search terms
 * stay English regardless of UI language).
 */
export interface CategoryMenuGroup {
  /** i18n key under `categoryMenu.` */
  key: string;
  link: string;
  subs: { key: string; link: string }[];
}

const search = (term: string) => `/products?search=${encodeURIComponent(term)}`;
const category = (cat: string) => `/products?category=${encodeURIComponent(cat)}`;

/** Groups arranged into columns, Olive Young style */
export const categoryMenuColumns: CategoryMenuGroup[][] = [
  [
    {
      key: 'skincare',
      link: category('Skincare'),
      subs: [
        { key: 'toner', link: search('Toner') },
        { key: 'serum', link: search('Serum') },
        { key: 'cream', link: search('Cream') },
        { key: 'lotion', link: search('Lotion') },
        { key: 'mistOil', link: search('Mist') },
        { key: 'skincareSet', link: search('Set') },
        { key: 'skincareDevice', link: search('Device') },
      ],
    },
    {
      key: 'maskPack',
      link: search('Mask'),
      subs: [
        { key: 'sheetMask', link: search('Sheet') },
        { key: 'padMask', link: search('Pad') },
        { key: 'facialPack', link: search('Pack') },
        { key: 'nosePack', link: search('Nose') },
        { key: 'patchMask', link: search('Patch') },
      ],
    },
    {
      key: 'cleansing',
      link: search('Cleansing'),
      subs: [
        { key: 'foamGel', link: search('Foam') },
        { key: 'oilBalm', link: search('Balm') },
        { key: 'waterMilk', link: search('Cleansing Water') },
        { key: 'scrub', link: search('Scrub') },
        { key: 'cleansingTissue', link: search('Tissue') },
        { key: 'lipEyeRemover', link: search('Remover') },
        { key: 'cleansingDevice', link: search('Cleansing Device') },
      ],
    },
    {
      key: 'sunCare',
      link: search('Sun'),
      subs: [
        { key: 'sunCream', link: search('Sun Cream') },
        { key: 'sunStick', link: search('Sun Stick') },
        { key: 'sunCushion', link: search('Sun Cushion') },
        { key: 'sunSpray', link: search('Sun Spray') },
        { key: 'tanningAfterSun', link: search('After Sun') },
      ],
    },
  ],
  [
    {
      key: 'makeup',
      link: category('Makeup'),
      subs: [
        { key: 'lipMakeup', link: search('Lip') },
        { key: 'baseMakeup', link: search('Base') },
        { key: 'eyeMakeup', link: search('Eye') },
      ],
    },
    {
      key: 'beautyTools',
      link: category('Beauty Tools'),
      subs: [
        { key: 'makeupTools', link: search('Tool') },
        { key: 'eyelashTools', link: search('Eyelash') },
        { key: 'faceTools', link: search('Face') },
        { key: 'hairBodyTools', link: search('Brush') },
        { key: 'dailyTools', link: search('Daily') },
      ],
    },
    {
      key: 'dermoCosmetic',
      link: search('Derma'),
      subs: [
        { key: 'skincare', link: search('Derma Skincare') },
        { key: 'bodyCare', link: search('Derma Body') },
        { key: 'cleansing', link: search('Derma Cleansing') },
        { key: 'sunCare', link: search('Derma Sun') },
        { key: 'maskPack', link: search('Derma Mask') },
      ],
    },
    {
      key: 'nail',
      link: search('Nail'),
      subs: [
        { key: 'basicNail', link: search('Nail Polish') },
        { key: 'gelNail', link: search('Gel Nail') },
        { key: 'nailTip', link: search('Nail Tip') },
        { key: 'nailCare', link: search('Nail Care') },
      ],
    },
  ],
  [
    {
      key: 'hairCare',
      link: category('Body/Hair'),
      subs: [
        { key: 'shampoo', link: search('Shampoo') },
        { key: 'treatment', link: search('Treatment') },
        { key: 'scalpCare', link: search('Scalp') },
        { key: 'hairEssence', link: search('Hair Essence') },
        { key: 'hairColor', link: search('Hair Color') },
        { key: 'hairTools', link: search('Hair Dryer') },
        { key: 'styling', link: search('Styling') },
      ],
    },
    {
      key: 'bodyCare',
      link: category('Body/Hair'),
      subs: [
        { key: 'showerBath', link: search('Shower') },
        { key: 'bodyLotion', link: search('Body Lotion') },
        { key: 'mistOil', link: search('Body Oil') },
        { key: 'hairRemoval', link: search('Wax') },
        { key: 'deodorant', link: search('Deodorant') },
        { key: 'handCare', link: search('Hand') },
        { key: 'footCare', link: search('Foot') },
        { key: 'babyMom', link: search('Baby') },
      ],
    },
    {
      key: 'fragrance',
      link: category('Fragrance'),
      subs: [
        { key: 'perfume', link: search('Perfume') },
        { key: 'miniPerfume', link: search('Mini') },
        { key: 'homeFragrance', link: search('Diffuser') },
      ],
    },
  ],
  [
    {
      key: 'healthFood',
      link: category('Health Food'),
      subs: [
        { key: 'vitamin', link: search('Vitamin') },
        { key: 'supplement', link: search('Supplement') },
        { key: 'probiotics', link: search('Probiotic') },
        { key: 'innerBeauty', link: search('Collagen') },
      ],
    },
    {
      key: 'food',
      link: search('Food'),
      subs: [
        { key: 'dietFood', link: search('Diet') },
        { key: 'snacks', link: search('Snack') },
        { key: 'drinks', link: search('Drink') },
        { key: 'instantFood', link: search('Instant') },
        { key: 'babyFood', link: search('Baby Food') },
      ],
    },
    {
      key: 'healthGoods',
      link: search('Health'),
      subs: [
        { key: 'patchCare', link: search('Patch') },
        { key: 'relaxGoods', link: search('Relax') },
        { key: 'medicalSupplies', link: search('Medical') },
        { key: 'massageSupport', link: search('Massage') },
        { key: 'fitnessGoods', link: search('Fitness') },
      ],
    },
  ],
  [
    {
      key: 'oralCare',
      link: search('Oral'),
      subs: [
        { key: 'toothbrush', link: search('Toothbrush') },
        { key: 'toothpaste', link: search('Toothpaste') },
        { key: 'afterOralCare', link: search('Mouthwash') },
        { key: 'portableOralSet', link: search('Oral Set') },
        { key: 'oralAppliance', link: search('Oral Device') },
      ],
    },
    {
      key: 'hygiene',
      link: search('Hygiene'),
      subs: [
        { key: 'femCare', link: search('Sanitary') },
        { key: 'intimateCare', link: search('Intimate') },
        { key: 'adultGoods', link: search('Adult') },
        { key: 'massageGel', link: search('Massage Gel') },
        { key: 'testKit', link: search('Test') },
        { key: 'diapers', link: search('Diaper') },
        { key: 'tissuePaper', link: search('Paper') },
      ],
    },
  ],
  [
    {
      key: 'fashion',
      link: search('Fashion'),
      subs: [
        { key: 'underwear', link: search('Underwear') },
        { key: 'fashionAccessories', link: search('Accessory') },
        { key: 'sportswear', link: search('Sports') },
        { key: 'homewear', link: search('Homewear') },
      ],
    },
    {
      key: 'homeLiving',
      link: search('Home'),
      subs: [
        { key: 'appliances', link: search('Appliance') },
        { key: 'kitchen', link: search('Kitchen') },
        { key: 'interior', link: search('Interior') },
        { key: 'bathroom', link: search('Bath') },
        { key: 'cleaning', link: search('Detergent') },
        { key: 'petSupplies', link: search('Pet') },
        { key: 'babyGoods', link: search('Kids') },
      ],
    },
    {
      key: 'hobby',
      link: search('Hobby'),
      subs: [
        { key: 'characterGoods', link: search('Character') },
        { key: 'stationery', link: search('Stationery') },
        { key: 'digital', link: search('Digital') },
        { key: 'albums', link: search('Album') },
      ],
    },
  ],
];
