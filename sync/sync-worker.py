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
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

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
            # No previous sync, do last 90 days
            start_date = (datetime.now() - timedelta(days=90)).strftime('%Y-%m-%d')
    else:
        # Full sync - last 2 years
        start_date = (datetime.now() - timedelta(days=730)).strftime('%Y-%m-%d')

    sqlite_conn.close()
    return (start_date, end_date)


def sync_yield_data(start_date: str, end_date: str) -> int:
    """
    Sync yield data from SQL Server to SQLite.

    Calls the stored procedure for each day in the range and inserts results.

    Returns:
        int: Number of records synced
    """
    print(f"Syncing yield data from {start_date} to {end_date}")

    sql_conn = get_sql_server_connection()
    sqlite_conn = get_sqlite_connection()

    sql_cursor = sql_conn.cursor()
    sqlite_cursor = sqlite_conn.cursor()

    # Parse dates
    current = datetime.strptime(start_date, '%Y-%m-%d')
    end = datetime.strptime(end_date, '%Y-%m-%d')

    records_synced = 0

    while current <= end:
        date_str = current.strftime('%Y-%m-%d')

        try:
            # Call stored procedure for this date
            sql_cursor.execute(f"EXEC {YIELD_SP} @date = ?", date_str)
            rows = sql_cursor.fetchall()

            # Delete existing data for this date
            sqlite_cursor.execute('DELETE FROM yield_data WHERE date = ?', (date_str,))

            # Insert new data
            for row in rows:
                sqlite_cursor.execute('''
                    INSERT INTO yield_data
                    (date, product_name, oi_qty, rec_qty, ship_qty, blend_qty, ci_qty, yield_qty)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    date_str,
                    row.product_name if hasattr(row, 'product_name') else row[0],
                    row.oi_qty if hasattr(row, 'oi_qty') else row[1],
                    row.rec_qty if hasattr(row, 'rec_qty') else row[2],
                    row.ship_qty if hasattr(row, 'ship_qty') else row[3],
                    row.blend_qty if hasattr(row, 'blend_qty') else row[4],
                    row.ci_qty if hasattr(row, 'ci_qty') else row[5],
                    row.yield_qty if hasattr(row, 'yield_qty') else row[6],
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
            # Call stored procedure
            sql_cursor.execute(f"EXEC {SALES_SP} @date = ?", date_str)
            rows = sql_cursor.fetchall()

            # Delete existing data
            sqlite_cursor.execute('DELETE FROM sales_data WHERE date = ?', (date_str,))

            # Insert new data (dividing by 42 to convert gallons to barrels)
            for row in rows:
                sqlite_cursor.execute('''
                    INSERT INTO sales_data
                    (date, product_name, product_desc, customer_name, transaction_type,
                     vol_qty_tr, vol_qty_h2o, vol_qty_pl, vol_qty_os, vol_qty_total)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    date_str,
                    row.product_name if hasattr(row, 'product_name') else row[0],
                    row.product_desc if hasattr(row, 'product_desc') else row[1],
                    row.customer_name if hasattr(row, 'customer_name') else row[2],
                    row.transaction_type if hasattr(row, 'transaction_type') else row[3],
                    (row.vol_qty_tr if hasattr(row, 'vol_qty_tr') else row[4]) / 42,
                    (row.vol_qty_h2o if hasattr(row, 'vol_qty_h2o') else row[5]) / 42,
                    (row.vol_qty_pl if hasattr(row, 'vol_qty_pl') else row[6]) / 42,
                    (row.vol_qty_os if hasattr(row, 'vol_qty_os') else row[7]) / 42,
                    (row.vol_qty_total if hasattr(row, 'vol_qty_total') else row[8]) / 42,
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
            CONVERT(DATE, RCNC_DT) as date,
            TANK_ID as tank_name,
            PRDT_NM as product_name,
            PRDT_TYPE as product_type,
            NET_VOL as volume
        FROM [Adv_hc].[Advisor3].[RCNC_TANK_VALU_RVW]
        WHERE RCNC_DT BETWEEN ? AND ?
        ORDER BY RCNC_DT, TANK_ID
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
            sqlite_cursor.execute('''
                INSERT INTO tank_data (date, tank_name, product_name, product_type, volume)
                VALUES (?, ?, ?, ?, ?)
            ''', (
                row.date.strftime('%Y-%m-%d') if hasattr(row.date, 'strftime') else str(row.date),
                row.tank_name,
                row.product_name,
                row.product_type,
                row.volume,
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
    parser.add_argument('--mode', choices=['full', 'incremental'], default='incremental',
                        help='Sync mode')
    parser.add_argument('--start-date', help='Override start date (YYYY-MM-DD)')
    parser.add_argument('--end-date', help='Override end date (YYYY-MM-DD)')

    args = parser.parse_args()

    print(f"Starting sync: type={args.type}, mode={args.mode}")
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
            else:
                start_date, end_date = get_date_range(args.mode, data_type)

            # Skip if no dates to sync
            if start_date > end_date:
                print(f"No new dates to sync for {data_type}")
                continue

            # Run appropriate sync function
            if data_type == 'yield':
                records = sync_yield_data(start_date, end_date)
            elif data_type == 'sales':
                records = sync_sales_data(start_date, end_date)
            elif data_type == 'tank':
                records = sync_tank_data(start_date, end_date)
            else:
                records = 0

            duration_ms = int((datetime.now() - start_time).total_seconds() * 1000)

            # Update status
            update_sync_status(data_type, 'success', records, duration_ms)
            print(f"\n✓ {data_type} sync complete: {records} records in {duration_ms}ms")

        except Exception as e:
            duration_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            update_sync_status(data_type, 'error', 0, duration_ms, str(e))
            print(f"\n✗ {data_type} sync failed: {e}")
            sys.exit(1)

    print("\n" + "="*50)
    print("All syncs completed successfully!")
    print("="*50)


if __name__ == '__main__':
    main()
