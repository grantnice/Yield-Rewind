# Yield Rewind

High-performance refinery analytics dashboard optimized for instant chart rendering and data visualization.

## Features

- **Ultra-Fast Charts**: Apache ECharts with Canvas rendering for 10x faster performance than SVG-based charts
- **Pre-Aggregated Data**: SQLite local database serves queries in <50ms instead of 36+ seconds from SQL Server
- **Real-Time Sync**: Background synchronization keeps data fresh without impacting query performance
- **Product Buckets**: Configurable product groupings for flexible analysis
- **Professional UI**: Clean, modern dashboard design with shadcn/ui components

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Yield Rewind                              │
├─────────────────────────────────────────────────────────────────┤
│  Next.js 15 Frontend                                            │
│  ├── ECharts (Canvas) - Sub-50ms render                         │
│  ├── TanStack Query - Smart caching                             │
│  └── shadcn/ui - Professional components                        │
├─────────────────────────────────────────────────────────────────┤
│  Next.js API Routes                                              │
│  └── Synchronous SQLite queries (better-sqlite3)                │
├─────────────────────────────────────────────────────────────────┤
│  SQLite Database (WAL mode)                                      │
│  └── Pre-aggregated data from SQL Server                        │
├─────────────────────────────────────────────────────────────────┤
│  Background Sync Service                                         │
│  ├── Python worker (pyodbc → SQLite)                            │
│  ├── Incremental: Every 15 minutes                              │
│  └── Full refresh: Daily at 2 AM                                │
└─────────────────────────────────────────────────────────────────┘
```

## Performance Targets

| Metric | Target | How |
|--------|--------|-----|
| Chart render | <50ms | ECharts Canvas + LTTB sampling |
| API response | <20ms | SQLite with indexed queries |
| Time to interactive | <1s | Pre-aggregated data |
| Large dataset (5 years) | <100ms | Data sampling + progressive render |

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.8+ (for sync worker)
- SQL Server connection (for data sync)

### Installation

```bash
# Clone repository
git clone https://github.com/grantnice/Yield-Rewind.git
cd Yield-Rewind

# Install dependencies
npm install

# Create data directory
mkdir -p data

# Start development server
npm run dev
```

### Initial Data Sync

```bash
# Set environment variables
export DB_SERVER=10.34.145.21
export DB_NAME=adv_hc
export DB_USER=DataAnalysis-ReadOnly
export DB_PASSWORD=your_password

# Run initial sync (last 90 days)
python sync/sync-worker.py --type all --mode incremental
```

## Project Structure

```
yield-rewind/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── page.tsx            # Dashboard
│   │   ├── yield/              # Yield Report
│   │   ├── sales/              # Sales Report
│   │   ├── tanks/              # Tank Inventory
│   │   ├── monthly-yield/      # Monthly Yield Table
│   │   ├── settings/           # Configuration
│   │   └── api/                # API Routes
│   ├── components/
│   │   ├── charts/             # ECharts components
│   │   ├── layout/             # Sidebar, Header
│   │   └── ui/                 # shadcn/ui components
│   └── lib/
│       ├── db.ts               # SQLite connection
│       ├── queries.ts          # Database queries
│       └── utils.ts            # Utilities
├── sync/
│   ├── sync-worker.py          # Python sync script
│   └── scheduler.ts            # Node.js scheduler
├── data/
│   └── yield-rewind.db         # SQLite database
└── package.json
```

## Pages

| Route | Description |
|-------|-------------|
| `/` | Dashboard with quick metrics |
| `/yield` | Yield trend analysis |
| `/sales` | Sales volume reporting |
| `/tanks` | Tank inventory levels |
| `/monthly-yield` | Monthly yield pivot table |
| `/settings` | Bucket configuration & sync status |

## Configuration

### Environment Variables

Create `.env.local`:

```env
# Optional: Override defaults
NEXT_PUBLIC_API_URL=http://localhost:3000
```

### Sync Worker Configuration

Environment variables for `sync/sync-worker.py`:

```env
DB_SERVER=10.34.145.21
DB_NAME=adv_hc
DB_USER=DataAnalysis-ReadOnly
DB_PASSWORD=your_password
```

### Product Buckets

Configure product aggregations in Settings > Bucket Config, or edit `src/lib/seed-buckets.ts` for defaults.

## Production Deployment

### PM2 (Recommended)

```bash
# Install PM2
npm install -g pm2

# Start application
pm2 start ecosystem.config.js

# Enable startup persistence
pm2 save
pm2 startup
```

### ecosystem.config.js

```javascript
module.exports = {
  apps: [
    {
      name: 'yield-rewind',
      script: 'npm',
      args: 'start',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
    {
      name: 'yield-rewind-sync',
      script: 'npx',
      args: 'ts-node sync/scheduler.ts',
      instances: 1,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
```

## Development

```bash
# Start dev server with hot reload
npm run dev

# Type checking
npm run type-check

# Build for production
npm run build

# Start production server
npm start
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/yield` | GET | Yield data with optional stats |
| `/api/sales` | GET | Sales data with optional stats |
| `/api/tanks` | GET | Tank inventory data |
| `/api/buckets` | GET/POST/DELETE | Bucket configuration |
| `/api/sync/status` | GET | Sync status for all data types |
| `/api/sync/trigger` | POST | Trigger manual sync |

## Key Technologies

- **Next.js 15** - React framework with App Router
- **Apache ECharts** - High-performance Canvas charting
- **better-sqlite3** - Synchronous SQLite for Node.js
- **TanStack Query** - Server state management
- **shadcn/ui** - Radix-based UI components
- **Tailwind CSS** - Utility-first styling
- **pyodbc** - Python SQL Server connectivity

## License

Internal use only - Monroe Energy refinery analytics.
