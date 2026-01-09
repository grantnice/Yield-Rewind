/**
 * Seed Default Product Bucket Configurations
 *
 * These buckets aggregate individual products into logical groups
 * for easier analysis and reporting.
 */

import { saveBucketConfig, getBucketConfigs } from './queries';

// Default Yield Buckets
// Special syntax: __CLASS:X aggregates all products with product_class = X
// __CALC:LOSS is calculated as Crude Rate - Non-Crude Total
const YIELD_BUCKETS = [
  {
    bucket_type: 'yield' as const,
    bucket_name: 'Crude Rate',
    component_products: ['__CLASS:F'],  // All Feedstock (crude) products
    is_virtual: false,
    display_order: 0,
  },
  {
    bucket_type: 'yield' as const,
    bucket_name: 'LPG',
    component_products: ['COMLPG', 'I-BUTANE', 'MOBPROP', 'N-BUTANE', 'PRO stenched', 'COMM PROPANE'],
    is_virtual: false,
    display_order: 1,
  },
  {
    bucket_type: 'yield' as const,
    bucket_name: 'CBOB',
    component_products: ['SUBOCTREG'],
    is_virtual: false,
    display_order: 2,
  },
  {
    bucket_type: 'yield' as const,
    bucket_name: 'PBOB',
    component_products: ['SUBOCTPRE'],
    is_virtual: false,
    display_order: 3,
  },
  {
    bucket_type: 'yield' as const,
    bucket_name: 'Jet',
    component_products: ['JET FUEL', 'JET A', 'JET A-1'],
    is_virtual: false,
    display_order: 4,
  },
  {
    bucket_type: 'yield' as const,
    bucket_name: 'ULSD',
    component_products: ['EXXON NO2', 'EXXON NO2 DYED', 'ULS DIESEL', 'ULS DYE DIESEL', 'ULSDX'],
    is_virtual: false,
    display_order: 5,
  },
  {
    bucket_type: 'yield' as const,
    bucket_name: 'VGO',
    component_products: ['VGO', 'VACUUM GAS OIL'],
    is_virtual: false,
    display_order: 6,
  },
  {
    bucket_type: 'yield' as const,
    bucket_name: 'VTB',
    component_products: ['VTB', 'VACUUM TOWER BOTTOMS'],
    is_virtual: false,
    display_order: 7,
  },
  {
    bucket_type: 'yield' as const,
    bucket_name: 'UMO VGO',
    component_products: ['UMO VGO', 'UMO VACUUM GAS OIL'],
    is_virtual: false,
    display_order: 8,
  },
  {
    bucket_type: 'yield' as const,
    bucket_name: 'Base Oil',
    component_products: ['BASE OIL', 'LUBE BASE OIL'],
    is_virtual: false,
    display_order: 9,
  },
  {
    bucket_type: 'yield' as const,
    bucket_name: 'Loss',
    component_products: ['__CALC:LOSS'],  // Calculated: Crude Rate - Non-Crude Total
    is_virtual: true,
    display_order: 10,
  },
  // Hidden buckets for internal calculations
  {
    bucket_type: 'yield' as const,
    bucket_name: 'Non-Crude Total',
    component_products: ['__CLASS:P'],  // All Product (output) products
    is_virtual: false,
    display_order: 99,  // Hidden from main display
  },
];

// Default Sales Buckets
const SALES_BUCKETS = [
  {
    bucket_type: 'sales' as const,
    bucket_name: 'ULSD',
    component_products: ['BP MV #2D', 'BR MV #2D S-15', 'EXXON NO2', 'EXXON NO2 DYED', 'GN #2D S15', 'GN ULS #2D DYE', 'TP 76 MV 2D', 'ULSDX'],
    is_virtual: false,
    display_order: 1,
  },
  {
    bucket_type: 'sales' as const,
    bucket_name: 'Regular',
    component_products: ['UB RUL 87 RVP', 'BP RUL 87 RVP', 'CITGO RUL 87R', 'EXXRULRVP', 'SHRUL87RVP', 'TP RUL 87 RVP', 'RUL87RVP>7.8', 'REG UNBRND', 'REG FSHELL', 'UBRUL87 NOETOH', 'SUBOCTREG'],
    is_virtual: false,
    display_order: 2,
  },
  {
    bucket_type: 'sales' as const,
    bucket_name: 'Premium',
    component_products: ['UB PUL 93 RVP', 'BP ULTIMATE93', 'CITGO PUL 93 R', 'EXXPUL93RVP', 'GNPUL93RVP', 'SHPUL93RVP', 'TP PUL 93 RVP', 'SUBOCTPRE'],
    is_virtual: false,
    display_order: 3,
  },
  {
    bucket_type: 'sales' as const,
    bucket_name: 'Jet',
    component_products: ['JET A', 'JET A-1', 'JET FSII'],
    is_virtual: false,
    display_order: 4,
  },
  {
    bucket_type: 'sales' as const,
    bucket_name: 'Commercial LPG',
    component_products: ['LPG COM', 'LPG PRO COMM', 'LPG PROP', 'LPG PRO sten', 'LPG IBUT', 'LPG NBUT'],
    is_virtual: false,
    display_order: 5,
  },
];

/**
 * Seed the default bucket configurations if they don't exist
 */
export function seedDefaultBuckets(): void {
  const existingYieldBuckets = getBucketConfigs('yield');
  const existingSalesBuckets = getBucketConfigs('sales');

  // Seed yield buckets if empty
  if (existingYieldBuckets.length === 0) {
    console.log('Seeding default yield buckets...');
    for (const bucket of YIELD_BUCKETS) {
      saveBucketConfig(bucket);
    }
    console.log(`Seeded ${YIELD_BUCKETS.length} yield buckets`);
  }

  // Seed sales buckets if empty
  if (existingSalesBuckets.length === 0) {
    console.log('Seeding default sales buckets...');
    for (const bucket of SALES_BUCKETS) {
      saveBucketConfig(bucket);
    }
    console.log(`Seeded ${SALES_BUCKETS.length} sales buckets`);
  }
}

// Auto-seed when module is imported in development
if (process.env.NODE_ENV !== 'production') {
  try {
    seedDefaultBuckets();
  } catch (error) {
    // Ignore errors during initial setup (DB might not exist yet)
  }
}
