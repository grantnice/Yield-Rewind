/**
 * SQLite Database Connection
 *
 * Uses better-sqlite3 for synchronous, fast database access.
 * The database file is stored at ./data/yield-rewind.db
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Ensure data directory exists
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'yield-rewind.db');

// Create database connection with optimizations
const db = new Database(dbPath, {
  // Enable WAL mode for better concurrent access
  // fileMustExist: false, // Create if doesn't exist
});

// Performance optimizations
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -64000'); // 64MB cache
db.pragma('temp_store = MEMORY');

// Initialize schema if needed
const initSchema = () => {
  db.exec(`
    -- Yield Data Table
    CREATE TABLE IF NOT EXISTS yield_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date DATE NOT NULL,
      product_name TEXT NOT NULL,
      oi_qty REAL,
      rec_qty REAL,
      ship_qty REAL,
      blend_qty REAL,
      ci_qty REAL,
      yield_qty REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(date, product_name)
    );

    CREATE INDEX IF NOT EXISTS idx_yield_date ON yield_data(date);
    CREATE INDEX IF NOT EXISTS idx_yield_product ON yield_data(product_name);
    CREATE INDEX IF NOT EXISTS idx_yield_date_product ON yield_data(date, product_name);

    -- Sales Data Table
    CREATE TABLE IF NOT EXISTS sales_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date DATE NOT NULL,
      product_name TEXT NOT NULL,
      product_desc TEXT,
      customer_name TEXT,
      transaction_type TEXT,
      vol_qty_tr REAL,
      vol_qty_h2o REAL,
      vol_qty_pl REAL,
      vol_qty_os REAL,
      vol_qty_total REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(date, product_name, customer_name)
    );

    CREATE INDEX IF NOT EXISTS idx_sales_date ON sales_data(date);
    CREATE INDEX IF NOT EXISTS idx_sales_product ON sales_data(product_name);
    CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales_data(customer_name);

    -- Tank Data Table
    CREATE TABLE IF NOT EXISTS tank_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date DATE NOT NULL,
      tank_name TEXT NOT NULL,
      product_name TEXT,
      product_type TEXT,
      volume REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(date, tank_name, product_name)
    );

    CREATE INDEX IF NOT EXISTS idx_tank_date ON tank_data(date);
    CREATE INDEX IF NOT EXISTS idx_tank_name ON tank_data(tank_name);
    CREATE INDEX IF NOT EXISTS idx_tank_type ON tank_data(product_type);

    -- Sync Status Table
    CREATE TABLE IF NOT EXISTS sync_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data_type TEXT NOT NULL UNIQUE,
      last_synced_date DATE,
      last_sync_at DATETIME,
      records_synced INTEGER,
      sync_duration_ms INTEGER,
      status TEXT,
      error_message TEXT
    );

    -- Bucket Configuration Table
    CREATE TABLE IF NOT EXISTS bucket_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bucket_type TEXT NOT NULL,
      bucket_name TEXT NOT NULL,
      component_products TEXT NOT NULL,
      is_virtual INTEGER DEFAULT 0,
      display_order INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(bucket_type, bucket_name)
    );

    -- Plan Numbers Table
    CREATE TABLE IF NOT EXISTS plan_numbers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month TEXT NOT NULL,
      product_name TEXT NOT NULL,
      plan_value REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(month, product_name)
    );

    -- User Preferences Table
    CREATE TABLE IF NOT EXISTS user_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      preference_key TEXT NOT NULL UNIQUE,
      preference_value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
};

// Initialize on first import
initSchema();

export { db };
export default db;
