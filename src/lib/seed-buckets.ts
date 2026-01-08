/**
 * Seed Default Product Bucket Configurations
 *
 * These buckets aggregate individual products into logical groups
 * for easier analysis and reporting.
 */

import { saveBucketConfig, getBucketConfigs } from './queries';

// Default Yield Buckets
const YIELD_BUCKETS = [
  {
    bucket_type: 'yield' as const,
    bucket_name: 'LPG',
    component_products: ['COMLPG', 'I-BUTANE', 'MOBPROP', 'N-BUTANE', 'PRO stenched'],
    is_virtual: false,
    display_order: 1,
  },
  {
    bucket_type: 'yield' as const,
    bucket_name: 'ULSD',
    component_products: ['EXXON NO2', 'EXXON NO2 DYED', 'ULS DIESEL', 'ULS DIESEL-D'],
    is_virtual: false,
    display_order: 2,
  },
  {
    bucket_type: 'yield' as const,
    bucket_name: 'Jet',
    component_products: ['JET A', 'JET A-1'],
    is_virtual: false,
    display_order: 3,
  },
  {
    bucket_type: 'yield' as const,
    bucket_name: 'CBOB',
    component_products: ['CBOB', 'CBOB SUB'],
    is_virtual: false,
    display_order: 4,
  },
  {
    bucket_type: 'yield' as const,
    bucket_name: 'RBOB',
    component_products: ['RBOB', 'RBOB SUB'],
    is_virtual: false,
    display_order: 5,
  },
  {
    bucket_type: 'yield' as const,
    bucket_name: 'Distillate',
    component_products: [
      'EXXON NO2', 'EXXON NO2 DYED', 'ULS DIESEL', 'ULS DIESEL-D',
      'JET A', 'JET A-1', 'LS DIESEL', 'HEAT OIL',
    ],
    is_virtual: false,
    display_order: 6,
  },
  {
    bucket_type: 'yield' as const,
    bucket_name: 'Crude Rate',
    component_products: [], // Virtual - calculated separately
    is_virtual: true,
    display_order: 100,
  },
  {
    bucket_type: 'yield' as const,
    bucket_name: 'Non-Crude Total',
    component_products: [], // Virtual - sum of all non-crude
    is_virtual: true,
    display_order: 101,
  },
  {
    bucket_type: 'yield' as const,
    bucket_name: 'Loss',
    component_products: [], // Virtual - Non-Crude Total - Crude Rate
    is_virtual: true,
    display_order: 102,
  },
];

// Default Sales Buckets
const SALES_BUCKETS = [
  {
    bucket_type: 'sales' as const,
    bucket_name: 'ULSD',
    component_products: ['BP MV #2D', 'BR MV #2D S-15', 'EXXON NO2', 'EXXON NO2 B100'],
    is_virtual: false,
    display_order: 1,
  },
  {
    bucket_type: 'sales' as const,
    bucket_name: 'Regular',
    component_products: ['REG 87 E10', 'REG 87 SUB E10', 'REGULAR UNLD'],
    is_virtual: false,
    display_order: 2,
  },
  {
    bucket_type: 'sales' as const,
    bucket_name: 'Premium',
    component_products: ['PREM 93 E10', 'PREM 93 SUB E10', 'PREMIUM UNLD'],
    is_virtual: false,
    display_order: 3,
  },
  {
    bucket_type: 'sales' as const,
    bucket_name: 'Jet',
    component_products: ['JET A', 'JET A-1', 'JET FUEL'],
    is_virtual: false,
    display_order: 4,
  },
  {
    bucket_type: 'sales' as const,
    bucket_name: 'Commercial LPG',
    component_products: ['LPG COM', 'LPG PRO COMM', 'PROPANE'],
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
