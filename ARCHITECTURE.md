# Yield Rewind - Architecture Map

## Overview

Yield Rewind is a refinery analytics dashboard that syncs operational data from SQL Server to a local SQLite database for high-performance visualization and reporting.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           YIELD REWIND ARCHITECTURE                         │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────┐     ┌──────────────────┐     ┌──────────────────────────┐
│   SQL Server     │     │  Python Sync     │     │   SQLite Database        │
│   (Source)       │────▶│  Worker          │────▶│   (Local Cache)          │
│                  │     │                  │     │                          │
│  10.34.145.21    │     │  sync-worker.py  │     │  yield-rewind.db         │
│  adv_hc database │     │                  │     │                          │
└──────────────────┘     └──────────────────┘     └────────────┬─────────────┘
                                │                              │
                                │                              │
                         ┌──────┴──────┐                       │
                         │  Scheduler  │                       │
                         │ scheduler.ts│                       │
                         └─────────────┘                       │
                                                               │
                         ┌─────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          NEXT.JS APPLICATION                                │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         API ROUTES                                   │   │
│  │  /api/yield          - Yield data queries                           │   │
│  │  /api/yield/mtd      - Month-to-date aggregations                   │   │
│  │  /api/yield/weekly   - Weekly aggregations                          │   │
│  │  /api/yield/trajectory - EOM projections                            │   │
│  │  /api/sales          - Sales volume data                            │   │
│  │  /api/tanks          - Tank inventory data                          │   │
│  │  /api/buckets        - Product bucket configuration                 │   │
│  │  /api/targets        - Monthly yield targets                        │   │
│  │  /api/periods        - Period definitions                           │   │
│  │  /api/sync/status    - Sync status                                  │   │
│  │  /api/sync/trigger   - Manual sync trigger                          │   │
│  │  /api/sync/prior-month - Prior month refresh                        │   │
│  │  /api/audit/*        - Audit trail endpoints                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         REACT PAGES                                  │   │
│  │  /                   - Dashboard (MTD summary)                      │   │
│  │  /yield              - Yield trend charts                           │   │
│  │  /weekly-yield       - Weekly yield analysis                        │   │
│  │  /monthly-yield      - Monthly yield pivot table                    │   │
│  │  /sales              - Sales volume reporting                       │   │
│  │  /tanks              - Tank inventory visualization                 │   │
│  │  /audit              - Data audit dashboard                         │   │
│  │  /settings           - Bucket & period configuration                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         UI COMPONENTS                                │   │
│  │  TimeSeriesChart     - ECharts-based visualization                  │   │
│  │  FreshnessBadge      - Data freshness indicator                     │   │
│  │  PeriodTabs          - Period navigation                            │   │
│  │  SyncIndicator       - Sync status display                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15, React 19, TailwindCSS |
| Charts | Apache ECharts 5.5 (Canvas-based) |
| State | TanStack React Query 5 |
| UI Components | Radix UI + shadcn/ui |
| Backend | Next.js API Routes |
| Database | SQLite (better-sqlite3) |
| Data Sync | Python 3 + pyodbc |
| Scheduler | node-schedule |
| Source DB | SQL Server (Advisor3) |

---

## Directory Structure

```
Yield-Rewind/
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── page.tsx             # Dashboard
│   │   ├── yield/page.tsx       # Yield trends
│   │   ├── weekly-yield/page.tsx
│   │   ├── monthly-yield/page.tsx
│   │   ├── sales/page.tsx
│   │   ├── tanks/page.tsx
│   │   ├── audit/page.tsx       # Audit dashboard
│   │   ├── settings/page.tsx
│   │   ├── api/                 # API endpoints
│   │   │   ├── yield/
│   │   │   ├── sales/
│   │   │   ├── tanks/
│   │   │   ├── buckets/
│   │   │   ├── targets/
│   │   │   ├── periods/
│   │   │   ├── sync/
│   │   │   └── audit/
│   │   ├── layout.tsx
│   │   └── providers.tsx
│   ├── components/
│   │   ├── charts/
│   │   │   └── time-series-chart.tsx
│   │   ├── layout/
│   │   │   ├── sidebar.tsx
│   │   │   └── header.tsx
│   │   ├── periods/
│   │   ├── sync/
│   │   ├── audit/
│   │   │   └── freshness-badge.tsx
│   │   └── ui/                  # shadcn components
│   └── lib/
│       ├── db.ts                # SQLite connection & schema
│       ├── queries.ts           # Query functions
│       └── utils.ts
├── sync/
│   ├── sync-worker.py           # Data sync from SQL Server
│   ├── scheduler.ts             # Cron job scheduler
│   └── COLUMN_REFERENCE.md
├── data/
│   └── yield-rewind.db          # SQLite database
├── .env                         # SQL Server credentials
└── package.json
```

---

## Data Flow

### 1. Data Ingestion (Sync)

```
SQL Server                    Python Worker                 SQLite
    │                              │                           │
    │  Stored Procedures           │                           │
    │  ─────────────────▶          │                           │
    │  gen_opnl_yld_rpt_data       │                           │
    │  gen_ship_by_prdt_sum_data   │                           │
    │  RCNC_TANK_VALU_RVW          │                           │
    │                              │                           │
    │                              │  Transform & Insert       │
    │                              │  ─────────────────▶       │
    │                              │  - Calculate yields       │
    │                              │  - Convert units          │
    │                              │  - Track changes          │
    │                              │                           │
```

### 2. Sync Schedule

| Job | Schedule | Mode | Data Types |
|-----|----------|------|------------|
| Incremental Yield | */15 * * * * | incremental | yield |
| Incremental Sales | 5,20,35,50 * * * * | incremental | sales |
| Incremental Tank | 10,25,40,55 * * * * | incremental | tank |
| Daily Full Sync | 0 2 * * * | full | all |
| Prior Month Day 5 | 0 3 5 * * | prior_month_refresh | all |
| Prior Month Day 10 | 0 3 10 * * | prior_month_refresh | all |

---

## Database Schema

### Core Data Tables

```sql
yield_data
├── id (PK)
├── date
├── product_name
├── product_class          -- 'F' (Feedstock) or 'P' (Product)
├── oi_qty, rec_qty, ship_qty, blend_qty, ci_qty
├── yield_qty              -- Calculated: blend + ci - oi - rec + ship
├── source_hash            -- For change detection
├── sync_count             -- Times this record was synced
├── first_synced_at, last_modified_at
└── last_sync_id           -- Reference to sync_log

sales_data
├── id (PK)
├── date
├── product_name, product_desc
├── customer_name, transaction_type
├── vol_qty_tr, vol_qty_h2o, vol_qty_pl, vol_qty_os
└── vol_qty_total          -- Sum of all volumes (in barrels)

tank_data
├── id (PK)
├── date
├── tank_name, product_name
├── hc_volume, h2o_volume
└── total_volume
```

### Configuration Tables

```sql
bucket_config              -- Product grouping definitions
├── bucket_type            -- 'yield' or 'sales'
├── bucket_name
├── component_products     -- JSON array
└── display_order

yield_targets              -- Monthly targets by bucket
├── bucket_name, month
├── monthly_plan_target, business_plan_target
└── monthly_plan_rate, business_plan_rate

monthly_periods            -- Sub-month period definitions
├── month, period_number
└── start_day, end_day

period_targets             -- Period-specific targets
├── bucket_name, month, period_number
└── targets...
```

### Audit Tables

```sql
sync_log                   -- Detailed sync audit trail
├── id (PK)
├── data_type, sync_mode, sync_reason
├── date_range_start, date_range_end
├── started_at, completed_at, status
├── records_fetched, records_inserted
├── records_updated, records_unchanged
└── error_message

yield_data_history         -- Change tracking
├── original_id, date, product_name
├── all yield fields (snapshot)
├── sync_id, change_type
├── previous_yield_qty
└── captured_at

sync_status                -- Quick status lookup (legacy)
├── data_type (unique)
├── last_synced_date, last_sync_at
├── records_synced, sync_duration_ms
└── status, error_message
```

---

## Key Features

### 1. Yield Calculations

```
Yield = Blend + Closing Inventory - Opening Inventory - Receipts + Shipments

Yield % = (Product Daily Avg / Crude Rate Daily Avg) × 100
```

### 2. Bucket Aggregation

Products are grouped into configurable buckets:
- **Regular buckets**: SUM of component products
- **Class buckets**: `__CLASS:F` (Feedstock), `__CLASS:P` (Products)
- **Calculated buckets**: `__CALC:LOSS` = 100% - Non-Crude %

### 3. Data Auditability

- **Change Detection**: Source hash comparison before updates
- **History Tracking**: All changes captured with before/after values
- **Prior Month Finalization**: Day 5 and Day 10 refreshes
- **Freshness Indicators**: Visual badges showing data age

### 4. Performance Optimizations

- **SQLite WAL mode**: Concurrent reads during writes
- **64MB cache**: Fast repeated queries
- **Indexed columns**: date, product_name, product_class
- **Canvas charts**: ECharts for 10x faster rendering than SVG

---

## API Response Format

All API endpoints return consistent format:

```json
{
  "data": [...],
  "meta": {
    "start_date": "2026-01-01",
    "end_date": "2026-01-11",
    "record_count": 440,
    "query_time_ms": 15
  }
}
```

---

## Environment Configuration

```env
DB_SERVER=10.34.145.21
DB_NAME=adv_hc
DB_USER=DataAnalysis-ReadOnly
DB_PASSWORD=***
```

---

## Trust & Auditability Features

| Feature | Location | Purpose |
|---------|----------|---------|
| Freshness Badge | Monthly Yield page | Shows data age (green/amber/red) |
| Prior Month Status | Monthly Yield page | Shows Day 5/10 refresh status |
| Sync History | /audit page | Complete log of all syncs |
| Change Log | /audit page | All data modifications tracked |
| Validation Status | /audit page | Schema and balance checks |

---

## Deployment

Using PM2 for process management:

```javascript
// ecosystem.config.js
{
  apps: [
    { name: 'yield-rewind', script: 'npm', args: 'start' },
    { name: 'yield-rewind-scheduler', script: 'sync/scheduler.ts' }
  ]
}
```

---

*Last updated: January 2026*
