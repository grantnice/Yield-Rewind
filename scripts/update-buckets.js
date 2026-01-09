// Script to update bucket configurations
// Run with: node scripts/update-buckets.js

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'yield-rewind.db');
const db = new Database(dbPath);

// Updated bucket definitions with correct display order:
// Crude Rate, LPG, CBOB, PBOB, Jet, ULSD, Distillate, VGO, VTB, UMO VGO, Base Oil, Loss
const YIELD_BUCKETS = [
  {
    bucket_type: 'yield',
    bucket_name: 'Crude Rate',
    component_products: ['__CLASS:F'],
    is_virtual: 0,
    display_order: 0,
  },
  {
    bucket_type: 'yield',
    bucket_name: 'LPG',
    component_products: ['COMLPG', 'I-BUTANE', 'MOBPROP', 'N-BUTANE', 'PRO stenched', 'COMM PROPANE'],
    is_virtual: 0,
    display_order: 1,
  },
  {
    bucket_type: 'yield',
    bucket_name: 'CBOB',
    component_products: ['SUBOCTREG'],
    is_virtual: 0,
    display_order: 2,
  },
  {
    bucket_type: 'yield',
    bucket_name: 'PBOB',
    component_products: ['SUBOCTPRE'],
    is_virtual: 0,
    display_order: 3,
  },
  {
    bucket_type: 'yield',
    bucket_name: 'Jet',
    component_products: ['JET FUEL', 'JET A', 'JET A-1'],
    is_virtual: 0,
    display_order: 4,
  },
  {
    bucket_type: 'yield',
    bucket_name: 'ULSD',
    component_products: ['EXXON NO2', 'EXXON NO2 DYED', 'ULS DIESEL', 'ULS DYE DIESEL'],
    is_virtual: 0,
    display_order: 5,
  },
  {
    bucket_type: 'yield',
    bucket_name: 'Distillate',
    component_products: [
      'EXXON NO2', 'EXXON NO2 DYED', 'ULS DIESEL', 'ULS DYE DIESEL',
      'JET FUEL', 'JET A', 'JET A-1',
    ],
    is_virtual: 0,
    display_order: 6,
  },
  {
    bucket_type: 'yield',
    bucket_name: 'VGO',
    component_products: ['VGO', 'VACUUM GAS OIL'],
    is_virtual: 0,
    display_order: 7,
  },
  {
    bucket_type: 'yield',
    bucket_name: 'VTB',
    component_products: ['VTB', 'VACUUM TOWER BOTTOMS', 'CATFEED'],
    is_virtual: 0,
    display_order: 8,
  },
  {
    bucket_type: 'yield',
    bucket_name: 'UMO VGO',
    component_products: ['UMO VGO', 'UMO VACUUM GAS OIL'],
    is_virtual: 0,
    display_order: 9,
  },
  {
    bucket_type: 'yield',
    bucket_name: 'Base Oil',
    component_products: ['BASE OIL', 'LUBE BASE OIL'],
    is_virtual: 0,
    display_order: 10,
  },
  {
    bucket_type: 'yield',
    bucket_name: 'Loss',
    component_products: ['__CALC:LOSS'],
    is_virtual: 1,
    display_order: 11,
  },
  // Hidden buckets for internal calculations
  {
    bucket_type: 'yield',
    bucket_name: 'Non-Crude Total',
    component_products: ['__CLASS:P'],
    is_virtual: 0,
    display_order: 99,
  },
  {
    bucket_type: 'yield',
    bucket_name: 'Gasoline',
    component_products: [
      'UB RUL 87 RVP', 'UB PUL 93 RVP', 'UB MUL 90 RVP',
      'EXXRULRVP', 'EXXPUL93RVP', 'GNPUL93RVP',
      'CITGO RUL 87R', 'CITGO PUL 93 R',
      'SHRUL87RVP', 'SHPUL93RVP', 'TP PUL 93 R',
      'RUL87RVP>7.8', 'Reg Unbrnd', 'UNLMIDGRADE',
    ],
    is_virtual: 0,
    display_order: 99, // Hidden - use CBOB/PBOB instead
  },
];

const stmt = db.prepare(`
  INSERT INTO bucket_config (bucket_type, bucket_name, component_products, is_virtual, display_order, updated_at)
  VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(bucket_type, bucket_name) DO UPDATE SET
    component_products = excluded.component_products,
    is_virtual = excluded.is_virtual,
    display_order = excluded.display_order,
    updated_at = CURRENT_TIMESTAMP
`);

console.log('Updating yield bucket configurations...');

for (const bucket of YIELD_BUCKETS) {
  stmt.run(
    bucket.bucket_type,
    bucket.bucket_name,
    JSON.stringify(bucket.component_products),
    bucket.is_virtual,
    bucket.display_order
  );
  console.log(`  Updated: ${bucket.bucket_name} (display_order: ${bucket.display_order})`);
}

// Verify
const result = db.prepare("SELECT bucket_name, display_order, component_products FROM bucket_config WHERE bucket_type = 'yield' ORDER BY display_order").all();
console.log('\nCurrent yield buckets:');
for (const row of result) {
  console.log(`  ${row.display_order}: ${row.bucket_name}`);
}

db.close();
console.log('\nDone!');
