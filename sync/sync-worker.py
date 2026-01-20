#!/usr/bin/env python3
"""
Sync Worker for Yield-Rewind

This script syncs data from SQL Server stored procedures to the local SQLite database.
It can be run:
  1. Manually: python sync-worker.py --type yield --mode full
  2. On schedule: Called by the Node.js scheduler
  3. Incremental: python sync-worker.py --type yield --mode incremental

The sync worker calls SQL Server stored procedures day-by-day, aggregates results,
and stores them in SQLite for instant query response times.
"""

import argparse
import sqlite3
import pyodbc
import hashlib
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

# Load environment variables from .env file
from dotenv import load_dotenv
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(env_path)

# Configuration
DB_CONFIG = {
    'server': os.environ.get('DB_SERVER', '10.34.145.21'),
    'database': os.environ.get('DB_NAME', 'adv_hc'),
    'username': os.environ.get('DB_USER', 'DataAnalysis-ReadOnly'),
    'password': os.environ.get('DB_PASSWORD', ''),
}

# SQLite database path (relative to project root)
SQLITE_DB_PATH = Path(__file__).parent.parent / 'data' / 'yield-rewind.db'

# Stored procedure mappings
YIELD_SP = '[Adv_hc].[Advisor3].[gen_opnl_yld_rpt_data]'
SALES_SP = '[Adv_hc].[Advisor3].[gen_ship_by_prdt_sum_data]'


def get_sql_server_connection():
    """Create connection to SQL Server."""
    conn_str = (
        f"DRIVER={{ODBC Driver 17 for SQL Server}};"
        f"SERVER={DB_CONFIG['server']};"
        f"DATABASE={DB_CONFIG['database']};"
        f"UID={DB_CONFIG['username']};"
        f"PWD={DB_CONFIG['password']}"
    )
    return pyodbc.connect(conn_str)


def get_sqlite_connection():
    """Create connection to SQLite database."""
    SQLITE_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(SQLITE_DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def get_yesterday():
    """Get yesterday's date as string."""
    return (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')


def get_prior_month_range() -> tuple:
    """Get date range for the prior month."""
    today = datetime.now()
    first_of_current = today.replace(day=1)
    last_of_prior = first_of_current - timedelta(days=1)
    first_of_prior = last_of_prior.replace(day=1)
    return (first_of_prior.strftime('%Y-%m-%d'), last_of_prior.strftime('%Y-%m-%d'))


def compute_source_hash(oi, rec, ship, blend, ci) -> str:
    """Compute a hash of source values for change detection."""
    values = f"{oi or 0}|{rec or 0}|{ship or 0}|{blend or 0}|{ci or 0}"
    return hashlib.md5(values.encode()).hexdigest()[:16]


def create_sync_log_entry(conn, data_type: str, sync_mode: str, sync_reason: str,
                          start_date: str, end_date: str) -> int:
    """Create a sync_log entry and return its ID."""
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO sync_log (data_type, sync_mode, sync_reason, date_range_start,
                              date_range_end, started_at, status)
        VALUES (?, ?, ?, ?, ?, ?, 'running')
    ''', (data_type, sync_mode, sync_reason, start_date, end_date, datetime.now().isoformat()))
    conn.commit()
    return cursor.lastrowid


def update_sync_log_completion(conn, sync_id: int, status: str, records_fetched: int,
                                records_inserted: int, records_updated: int,
                                records_unchanged: int, error_message: str = None):
    """Update sync_log entry on completion."""
    cursor = conn.cursor()
    cursor.execute('''
        UPDATE sync_log SET
            completed_at = ?,
            status = ?,
            records_fetched = ?,
            records_inserted = ?,
            records_updated = ?,
            records_unchanged = ?,
            error_message = ?
        WHERE id = ?
    ''', (datetime.now().isoformat(), status, records_fetched, records_inserted,
          records_updated, records_unchanged, error_message, sync_id))
    conn.commit()


def capture_yield_history(conn, existing_record: dict, sync_id: int, change_type: str):
    """Capture a historical snapshot of yield data before update."""
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO yield_data_history
        (original_id, date, product_name, product_class, oi_qty, rec_qty, ship_qty,
         blend_qty, ci_qty, yield_qty, sync_id, change_type, previous_yield_qty)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        existing_record['id'],
        existing_record['date'],
        existing_record['product_name'],
        existing_record['product_class'],
        existing_record['oi_qty'],
        existing_record['rec_qty'],
        existing_record['ship_qty'],
        existing_record['blend_qty'],
        existing_record['ci_qty'],
        existing_record['yield_qty'],
        sync_id,
        change_type,
        existing_record['yield_qty'],
    ))
    conn.commit()


def get_date_range(mode: str, data_type: str) -> tuple:
    """
    Calculate date range based on sync mode.

    Returns:
        tuple: (start_date, end_date) as strings
    """
    sqlite_conn = get_sqlite_connection()
    cursor = sqlite_conn.cursor()

    end_date = get_yesterday()

    if mode == 'incremental':
        # Get last synced date
        cursor.execute(
            'SELECT last_synced_date FROM sync_status WHERE data_type = ?',
            (data_type,)
        )
        row = cursor.fetchone()

        if row and row['last_synced_date']:
            # Start from day after last sync
            last_date = datetime.strptime(row['last_synced_date'], '%Y-%m-%d')
            start_date = (last_date + timedelta(days=1)).strftime('%Y-%m-%d')
        else:
            # No previous sync, start from beginning of 2025
            start_date = '2025-01-01'
    else:
        # Full sync - all of 2025 onwards
        start_date = '2025-01-01'

    sqlite_conn.close()
    return (start_date, end_date)


def sync_yield_data(start_date: str, end_date: str, sync_mode: str = 'incremental',
                    sync_reason: str = 'scheduled') -> dict:
    """
    Sync yield data from SQL Server to SQLite with change detection.

    Calls the stored procedure for each day in the range and inserts results.
    Tracks changes and maintains history.

    Returns:
        dict: Sync statistics (fetched, inserted, updated, unchanged)
    """
    print(f"Syncing yield data from {start_date} to {end_date} (mode={sync_mode}, reason={sync_reason})")

    sql_conn = get_sql_server_connection()
    sqlite_conn = get_sqlite_connection()

    sql_cursor = sql_conn.cursor()
    sqlite_cursor = sqlite_conn.cursor()

    # Create sync log entry
    sync_id = create_sync_log_entry(sqlite_conn, 'yield', sync_mode, sync_reason, start_date, end_date)

    stats = {
        'fetched': 0,
        'inserted': 0,
        'updated': 0,
        'unchanged': 0,
    }

    # Parse dates
    current = datetime.strptime(start_date, '%Y-%m-%d')
    end = datetime.strptime(end_date, '%Y-%m-%d')

    try:
        while current <= end:
            date_str = current.strftime('%Y-%m-%d')

            try:
                # Call stored procedure for this date
                sql_cursor.execute(f"SET NOCOUNT ON; EXEC {YIELD_SP} @rp_bgn_dte = ?, @rp_end_dte = ?", date_str, date_str)
                rows = sql_cursor.fetchall()
                stats['fetched'] += len(rows)

                for row in rows:
                    # Product class: 'F' = Feedstock (crude), 'P' = Product (output)
                    product_class = row[1].strip() if row[1] else None
                    product_name = row.smry_prdt_nme.strip() if hasattr(row, 'smry_prdt_nme') else str(row[4]).strip()
                    oi = row.oi_qty if hasattr(row, 'oi_qty') else row[5]
                    rec = row.rec_qty if hasattr(row, 'rec_qty') else row[6]
                    ship = row.ship_qty if hasattr(row, 'ship_qty') else row[7]
                    blend = row.blend_qty if hasattr(row, 'blend_qty') else row[8]
                    ci = row.ci_qty if hasattr(row, 'ci_qty') else row[9]

                    # Calculate yield and source hash
                    yield_qty = (blend or 0) + (ci or 0) - (oi or 0) - (rec or 0) + (ship or 0)
                    source_hash = compute_source_hash(oi, rec, ship, blend, ci)

                    # Check for existing record
                    sqlite_cursor.execute('''
                        SELECT id, source_hash, sync_count, oi_qty, rec_qty, ship_qty, blend_qty, ci_qty,
                               yield_qty, product_class, date, product_name
                        FROM yield_data WHERE date = ? AND product_name = ?
                    ''', (date_str, product_name))
                    existing = sqlite_cursor.fetchone()

                    if existing:
                        existing_dict = dict(existing)
                        if existing_dict.get('source_hash') == source_hash:
                            # No change
                            stats['unchanged'] += 1
                            continue
                        else:
                            # Record changed - capture history
                            change_type = 'prior_month_refresh' if sync_mode == 'prior_month_refresh' else 'update'
                            capture_yield_history(sqlite_conn, existing_dict, sync_id, change_type)
                            stats['updated'] += 1
                            sync_count = (existing_dict.get('sync_count') or 1) + 1
                            first_synced = None  # Keep existing
                    else:
                        stats['inserted'] += 1
                        sync_count = 1
                        first_synced = datetime.now().isoformat()

                    # Insert/update record with audit fields
                    if existing:
                        sqlite_cursor.execute('''
                            UPDATE yield_data SET
                                product_class = ?, oi_qty = ?, rec_qty = ?, ship_qty = ?,
                                blend_qty = ?, ci_qty = ?, yield_qty = ?, last_sync_id = ?,
                                last_modified_at = ?, sync_count = ?, source_hash = ?
                            WHERE id = ?
                        ''', (
                            product_class, oi, rec, ship, blend, ci, yield_qty, sync_id,
                            datetime.now().isoformat(), sync_count, source_hash, existing_dict['id']
                        ))
                    else:
                        sqlite_cursor.execute('''
                            INSERT INTO yield_data
                            (date, product_name, product_class, oi_qty, rec_qty, ship_qty,
                             blend_qty, ci_qty, yield_qty, last_sync_id, first_synced_at,
                             last_modified_at, sync_count, source_hash)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ''', (
                            date_str, product_name, product_class, oi, rec, ship, blend, ci,
                            yield_qty, sync_id, first_synced, datetime.now().isoformat(),
                            sync_count, source_hash
                        ))

                sqlite_conn.commit()
                day_changes = stats['inserted'] + stats['updated'] - (stats.get('prev_changes') or 0)
                stats['prev_changes'] = stats['inserted'] + stats['updated']
                print(f"  {date_str}: {len(rows)} fetched, {day_changes} changed")

            except Exception as e:
                print(f"  {date_str}: Error - {e}")

            current += timedelta(days=1)

        # Update sync log with success
        update_sync_log_completion(sqlite_conn, sync_id, 'success',
                                   stats['fetched'], stats['inserted'],
                                   stats['updated'], stats['unchanged'])

    except Exception as e:
        update_sync_log_completion(sqlite_conn, sync_id, 'failed',
                                   stats['fetched'], stats['inserted'],
                                   stats['updated'], stats['unchanged'], str(e))
        raise

    finally:
        sql_conn.close()
        sqlite_conn.close()

    return stats


def sync_sales_data(start_date: str, end_date: str) -> int:
    """
    Sync sales data from SQL Server to SQLite.

    Returns:
        int: Number of records synced
    """
    print(f"Syncing sales data from {start_date} to {end_date}")

    sql_conn = get_sql_server_connection()
    sqlite_conn = get_sqlite_connection()

    sql_cursor = sql_conn.cursor()
    sqlite_cursor = sqlite_conn.cursor()

    current = datetime.strptime(start_date, '%Y-%m-%d')
    end = datetime.strptime(end_date, '%Y-%m-%d')

    records_synced = 0

    while current <= end:
        date_str = current.strftime('%Y-%m-%d')

        try:
            # Call stored procedure (uses begin/end date params)
            sql_cursor.execute(f"SET NOCOUNT ON; EXEC {SALES_SP} @rp_bgn_dte = ?, @rp_end_dte = ?", date_str, date_str)
            rows = sql_cursor.fetchall()

            # Delete existing data
            sqlite_cursor.execute('DELETE FROM sales_data WHERE date = ?', (date_str,))

            # Insert new data (dividing by 42 to convert gallons to barrels)
            for row in rows:
                # Get volume values (SP returns: prdt_nme, prdt_desc_txt, cust_nme, trns_type_cde, vol_qty_tr, vol_qty_h2o, vol_qty_pl, vol_qty_os)
                vol_tr = (row.vol_qty_tr if hasattr(row, 'vol_qty_tr') else row[4]) / 42
                vol_h2o = (row.vol_qty_h2o if hasattr(row, 'vol_qty_h2o') else row[5]) / 42
                vol_pl = (row.vol_qty_pl if hasattr(row, 'vol_qty_pl') else row[6]) / 42
                vol_os = (row.vol_qty_os if hasattr(row, 'vol_qty_os') else row[7]) / 42
                vol_total = vol_tr + vol_h2o + vol_pl + vol_os  # Calculate total from components

                sqlite_cursor.execute('''
                    INSERT OR REPLACE INTO sales_data
                    (date, product_name, product_desc, customer_name, transaction_type,
                     vol_qty_tr, vol_qty_h2o, vol_qty_pl, vol_qty_os, vol_qty_total)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    date_str,
                    row.prdt_nme if hasattr(row, 'prdt_nme') else row[0],
                    row.prdt_desc_txt if hasattr(row, 'prdt_desc_txt') else row[1],
                    row.cust_nme if hasattr(row, 'cust_nme') else row[2],
                    row.trns_type_cde if hasattr(row, 'trns_type_cde') else row[3],
                    vol_tr,
                    vol_h2o,
                    vol_pl,
                    vol_os,
                    vol_total,
                ))
                records_synced += 1

            sqlite_conn.commit()
            print(f"  {date_str}: {len(rows)} records")

        except Exception as e:
            print(f"  {date_str}: Error - {e}")

        current += timedelta(days=1)

    sql_conn.close()
    sqlite_conn.close()

    return records_synced


def sync_tank_data(start_date: str, end_date: str) -> int:
    """
    Sync tank inventory data from SQL Server to SQLite.

    Uses direct query instead of stored procedure.

    Returns:
        int: Number of records synced
    """
    print(f"Syncing tank data from {start_date} to {end_date}")

    sql_conn = get_sql_server_connection()
    sqlite_conn = get_sqlite_connection()

    sql_cursor = sql_conn.cursor()
    sqlite_cursor = sqlite_conn.cursor()

    query = """
        SELECT
            CONVERT(DATE, RCNC_END_TMSP) as date,
            VESS_NME as tank_name,
            PRDT_NME as product_name,
            COALESCE(UCRT_VOL_QTY, 0) as hc_volume,
            COALESCE(H2O_VOL_QTY, 0) as h2o_volume
        FROM [Adv_hc].[Advisor3].[RCNC_TANK_VALU_RVW]
        WHERE RCNC_END_TMSP BETWEEN ? AND ?
        ORDER BY RCNC_END_TMSP, VESS_NME
    """

    try:
        sql_cursor.execute(query, start_date, end_date)
        rows = sql_cursor.fetchall()

        # Delete existing data in range
        sqlite_cursor.execute(
            'DELETE FROM tank_data WHERE date BETWEEN ? AND ?',
            (start_date, end_date)
        )

        records_synced = 0
        for row in rows:
            product_name = row.product_name.strip() if row.product_name else ''
            hc_vol = row.hc_volume or 0
            h2o_vol = row.h2o_volume or 0
            total_vol = hc_vol + h2o_vol

            sqlite_cursor.execute('''
                INSERT OR REPLACE INTO tank_data (date, tank_name, product_name, hc_volume, h2o_volume, total_volume)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (
                row.date.strftime('%Y-%m-%d') if hasattr(row.date, 'strftime') else str(row.date),
                row.tank_name.strip() if row.tank_name else '',
                product_name,
                hc_vol,
                h2o_vol,
                total_vol,
            ))
            records_synced += 1

        sqlite_conn.commit()
        print(f"  Synced {records_synced} tank records")

    except Exception as e:
        print(f"  Error syncing tank data: {e}")
        records_synced = 0

    sql_conn.close()
    sqlite_conn.close()

    return records_synced


def update_sync_status(data_type: str, status: str, records: int, duration_ms: int, error: str = None):
    """Update sync status in SQLite."""
    conn = get_sqlite_connection()
    cursor = conn.cursor()

    cursor.execute('''
        INSERT INTO sync_status
        (data_type, last_synced_date, last_sync_at, records_synced, sync_duration_ms, status, error_message)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(data_type) DO UPDATE SET
            last_synced_date = excluded.last_synced_date,
            last_sync_at = excluded.last_sync_at,
            records_synced = excluded.records_synced,
            sync_duration_ms = excluded.sync_duration_ms,
            status = excluded.status,
            error_message = excluded.error_message
    ''', (
        data_type,
        get_yesterday(),
        datetime.now().isoformat(),
        records,
        duration_ms,
        status,
        error,
    ))

    conn.commit()
    conn.close()


def main():
    parser = argparse.ArgumentParser(description='Sync data from SQL Server to SQLite')
    parser.add_argument('--type', choices=['yield', 'sales', 'tank', 'all'], default='all',
                        help='Type of data to sync')
    parser.add_argument('--mode', choices=['full', 'incremental', 'prior_month_refresh'], default='incremental',
                        help='Sync mode')
    parser.add_argument('--prior-month', action='store_true',
                        help='Refresh prior month data (shortcut for --mode prior_month_refresh)')
    parser.add_argument('--refresh-reason', choices=['manual', 'manual_mtd', 'mtd_full_refresh', 'scheduled', 'day_5_refresh', 'day_10_refresh'],
                        default='scheduled', help='Reason for sync (for audit trail)')
    parser.add_argument('--start-date', help='Override start date (YYYY-MM-DD)')
    parser.add_argument('--end-date', help='Override end date (YYYY-MM-DD)')

    args = parser.parse_args()

    # Handle --prior-month shortcut
    sync_mode = args.mode
    if args.prior_month:
        sync_mode = 'prior_month_refresh'

    print(f"Starting sync: type={args.type}, mode={sync_mode}, reason={args.refresh_reason}")
    print(f"SQLite DB: {SQLITE_DB_PATH}")

    data_types = ['yield', 'sales', 'tank'] if args.type == 'all' else [args.type]

    for data_type in data_types:
        print(f"\n{'='*50}")
        print(f"Syncing {data_type} data")
        print('='*50)

        start_time = datetime.now()

        try:
            # Get date range
            if args.start_date and args.end_date:
                start_date, end_date = args.start_date, args.end_date
            elif sync_mode == 'prior_month_refresh':
                start_date, end_date = get_prior_month_range()
                print(f"Prior month refresh: {start_date} to {end_date}")
            else:
                start_date, end_date = get_date_range(sync_mode, data_type)

            # Skip if no dates to sync
            if start_date > end_date:
                print(f"No new dates to sync for {data_type}")
                continue

            # Run appropriate sync function
            if data_type == 'yield':
                result = sync_yield_data(start_date, end_date, sync_mode, args.refresh_reason)
                records = result['fetched']
                print(f"\n  Stats: {result['inserted']} inserted, {result['updated']} updated, {result['unchanged']} unchanged")
            elif data_type == 'sales':
                records = sync_sales_data(start_date, end_date)
            elif data_type == 'tank':
                records = sync_tank_data(start_date, end_date)
            else:
                records = 0

            duration_ms = int((datetime.now() - start_time).total_seconds() * 1000)

            # Update legacy sync_status table for backward compatibility
            update_sync_status(data_type, 'success', records, duration_ms)
            print(f"\n[OK] {data_type} sync complete: {records} records in {duration_ms}ms")

        except Exception as e:
            duration_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            update_sync_status(data_type, 'error', 0, duration_ms, str(e))
            print(f"\n[ERROR] {data_type} sync failed: {e}")
            sys.exit(1)

    print("\n" + "="*50)
    print("All syncs completed successfully!")
    print("="*50)


if __name__ == '__main__':
    main()
