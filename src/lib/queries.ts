/**
 * Database Query Functions
 *
 * Optimized queries for fast data retrieval from SQLite.
 * All queries are synchronous (better-sqlite3) for maximum performance.
 */

import db from './db';

// ============================================
// YIELD DATA QUERIES
// ============================================

export interface YieldDataRow {
  id: number;
  date: string;
  product_name: string;
  product_class: string | null; // 'F' = Feedstock, 'P' = Product
  oi_qty: number | null;
  rec_qty: number | null;
  ship_qty: number | null;
  blend_qty: number | null;
  ci_qty: number | null;
  yield_qty: number | null;
}

export function getYieldData(
  startDate: string,
  endDate: string,
  products?: string[]
): YieldDataRow[] {
  if (products && products.length > 0) {
    const placeholders = products.map(() => '?').join(',');
    const stmt = db.prepare(`
      SELECT id, date, product_name, product_class, oi_qty, rec_qty, ship_qty, blend_qty, ci_qty, yield_qty
      FROM yield_data
      WHERE date BETWEEN ? AND ?
        AND product_name IN (${placeholders})
      ORDER BY date DESC, product_name ASC
    `);
    return stmt.all(startDate, endDate, ...products) as YieldDataRow[];
  }

  const stmt = db.prepare(`
    SELECT id, date, product_name, product_class, oi_qty, rec_qty, ship_qty, blend_qty, ci_qty, yield_qty
    FROM yield_data
    WHERE date BETWEEN ? AND ?
    ORDER BY date DESC, product_name ASC
  `);
  return stmt.all(startDate, endDate) as YieldDataRow[];
}

export function getYieldProducts(): string[] {
  const stmt = db.prepare(`
    SELECT DISTINCT product_name
    FROM yield_data
    ORDER BY product_name ASC
  `);
  const rows = stmt.all() as { product_name: string }[];
  return rows.map((r) => r.product_name);
}

// ============================================
// SALES DATA QUERIES
// ============================================

export interface SalesDataRow {
  id: number;
  date: string;
  product_name: string;
  product_desc: string | null;
  customer_name: string | null;
  transaction_type: string | null;
  vol_qty_tr: number | null;
  vol_qty_h2o: number | null;
  vol_qty_pl: number | null;
  vol_qty_os: number | null;
  vol_qty_total: number | null;
}

export function getSalesData(
  startDate: string,
  endDate: string,
  products?: string[],
  customers?: string[]
): SalesDataRow[] {
  let query = `
    SELECT id, date, product_name, product_desc, customer_name, transaction_type,
           vol_qty_tr, vol_qty_h2o, vol_qty_pl, vol_qty_os, vol_qty_total
    FROM sales_data
    WHERE date BETWEEN ? AND ?
  `;
  const params: (string | number)[] = [startDate, endDate];

  if (products && products.length > 0) {
    const placeholders = products.map(() => '?').join(',');
    query += ` AND product_name IN (${placeholders})`;
    params.push(...products);
  }

  if (customers && customers.length > 0) {
    const placeholders = customers.map(() => '?').join(',');
    query += ` AND customer_name IN (${placeholders})`;
    params.push(...customers);
  }

  query += ' ORDER BY date DESC, product_name ASC';

  const stmt = db.prepare(query);
  return stmt.all(...params) as SalesDataRow[];
}

export function getSalesProducts(): string[] {
  const stmt = db.prepare(`
    SELECT DISTINCT product_name
    FROM sales_data
    ORDER BY product_name ASC
  `);
  const rows = stmt.all() as { product_name: string }[];
  return rows.map((r) => r.product_name);
}

export function getSalesCustomers(): string[] {
  const stmt = db.prepare(`
    SELECT DISTINCT customer_name
    FROM sales_data
    WHERE customer_name IS NOT NULL
    ORDER BY customer_name ASC
  `);
  const rows = stmt.all() as { customer_name: string }[];
  return rows.map((r) => r.customer_name);
}

// ============================================
// TANK DATA QUERIES
// ============================================

export interface TankDataRow {
  id: number;
  date: string;
  tank_name: string;
  product_name: string | null;
  hc_volume: number | null;
  h2o_volume: number | null;
  total_volume: number | null;
}

export function getTankData(
  startDate: string,
  endDate: string,
  tankIds?: string[],
  volumeType?: 'WATER' | 'HC' | 'ALL'
): TankDataRow[] {
  // Select the appropriate volume column based on volumeType
  let volumeSelect = 'hc_volume, h2o_volume, total_volume';

  let query = `
    SELECT id, date, tank_name, product_name, ${volumeSelect}
    FROM tank_data
    WHERE date BETWEEN ? AND ?
  `;
  const params: (string | number)[] = [startDate, endDate];

  if (tankIds && tankIds.length > 0) {
    const placeholders = tankIds.map(() => '?').join(',');
    query += ` AND tank_name IN (${placeholders})`;
    params.push(...tankIds);
  }

  // Filter out rows with zero volume based on type
  if (volumeType === 'HC') {
    query += ' AND hc_volume > 0';
  } else if (volumeType === 'WATER') {
    query += ' AND h2o_volume > 0';
  }

  query += ' ORDER BY date ASC, tank_name ASC';

  const stmt = db.prepare(query);
  return stmt.all(...params) as TankDataRow[];
}

export function getTankList(): { tank_name: string; product_types: string[] }[] {
  const stmt = db.prepare(`
    SELECT tank_name, GROUP_CONCAT(DISTINCT product_type) as product_types
    FROM tank_data
    GROUP BY tank_name
    ORDER BY tank_name ASC
  `);
  const rows = stmt.all() as { tank_name: string; product_types: string }[];
  return rows.map((r) => ({
    tank_name: r.tank_name,
    product_types: r.product_types ? r.product_types.split(',') : [],
  }));
}

// ============================================
// SYNC STATUS QUERIES
// ============================================

export interface SyncStatus {
  data_type: string;
  last_synced_date: string | null;
  last_sync_at: string | null;
  records_synced: number | null;
  sync_duration_ms: number | null;
  status: string | null;
  error_message: string | null;
}

export function getSyncStatus(): SyncStatus[] {
  const stmt = db.prepare(`
    SELECT data_type, last_synced_date, last_sync_at, records_synced,
           sync_duration_ms, status, error_message
    FROM sync_status
  `);
  return stmt.all() as SyncStatus[];
}

export function updateSyncStatus(
  dataType: string,
  status: Partial<SyncStatus>
): void {
  const stmt = db.prepare(`
    INSERT INTO sync_status (data_type, last_synced_date, last_sync_at, records_synced, sync_duration_ms, status, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(data_type) DO UPDATE SET
      last_synced_date = excluded.last_synced_date,
      last_sync_at = excluded.last_sync_at,
      records_synced = excluded.records_synced,
      sync_duration_ms = excluded.sync_duration_ms,
      status = excluded.status,
      error_message = excluded.error_message
  `);
  stmt.run(
    dataType,
    status.last_synced_date || null,
    status.last_sync_at || new Date().toISOString(),
    status.records_synced || 0,
    status.sync_duration_ms || 0,
    status.status || 'unknown',
    status.error_message || null
  );
}

// ============================================
// BUCKET CONFIG QUERIES
// ============================================

export interface BucketConfig {
  id: number;
  bucket_type: string;
  bucket_name: string;
  component_products: string[];
  is_virtual: boolean;
  display_order: number;
}

export function getBucketConfigs(bucketType?: 'yield' | 'sales'): BucketConfig[] {
  let query = `
    SELECT id, bucket_type, bucket_name, component_products, is_virtual, display_order
    FROM bucket_config
  `;
  const params: string[] = [];

  if (bucketType) {
    query += ' WHERE bucket_type = ?';
    params.push(bucketType);
  }

  query += ' ORDER BY display_order ASC';

  const stmt = db.prepare(query);
  const rows = stmt.all(...params) as {
    id: number;
    bucket_type: string;
    bucket_name: string;
    component_products: string;
    is_virtual: number;
    display_order: number;
  }[];

  return rows.map((r) => ({
    id: r.id,
    bucket_type: r.bucket_type,
    bucket_name: r.bucket_name,
    component_products: JSON.parse(r.component_products),
    is_virtual: r.is_virtual === 1,
    display_order: r.display_order,
  }));
}

export function saveBucketConfig(config: Omit<BucketConfig, 'id'>): void {
  const stmt = db.prepare(`
    INSERT INTO bucket_config (bucket_type, bucket_name, component_products, is_virtual, display_order, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(bucket_type, bucket_name) DO UPDATE SET
      component_products = excluded.component_products,
      is_virtual = excluded.is_virtual,
      display_order = excluded.display_order,
      updated_at = CURRENT_TIMESTAMP
  `);
  stmt.run(
    config.bucket_type,
    config.bucket_name,
    JSON.stringify(config.component_products),
    config.is_virtual ? 1 : 0,
    config.display_order
  );
}

// ============================================
// STATISTICS QUERIES
// ============================================

export interface ProductStats {
  product_name: string;
  count: number;
  mean: number;
  min: number;
  max: number;
  total: number;
}

export function getYieldStatistics(
  startDate: string,
  endDate: string,
  products?: string[]
): ProductStats[] {
  let query = `
    SELECT
      product_name,
      COUNT(*) as count,
      AVG(yield_qty) as mean,
      MIN(yield_qty) as min,
      MAX(yield_qty) as max,
      SUM(yield_qty) as total
    FROM yield_data
    WHERE date BETWEEN ? AND ?
      AND yield_qty IS NOT NULL
  `;
  const params: string[] = [startDate, endDate];

  if (products && products.length > 0) {
    const placeholders = products.map(() => '?').join(',');
    query += ` AND product_name IN (${placeholders})`;
    params.push(...products);
  }

  query += ' GROUP BY product_name ORDER BY mean DESC';

  const stmt = db.prepare(query);
  return stmt.all(...params) as ProductStats[];
}

export function getSalesStatistics(
  startDate: string,
  endDate: string,
  metric: string = 'vol_qty_total',
  products?: string[]
): ProductStats[] {
  let query = `
    SELECT
      product_name,
      COUNT(*) as count,
      AVG(${metric}) as mean,
      MIN(${metric}) as min,
      MAX(${metric}) as max,
      SUM(${metric}) as total
    FROM sales_data
    WHERE date BETWEEN ? AND ?
      AND ${metric} IS NOT NULL
  `;
  const params: string[] = [startDate, endDate];

  if (products && products.length > 0) {
    const placeholders = products.map(() => '?').join(',');
    query += ` AND product_name IN (${placeholders})`;
    params.push(...products);
  }

  query += ' GROUP BY product_name ORDER BY mean DESC';

  const stmt = db.prepare(query);
  return stmt.all(...params) as ProductStats[];
}
