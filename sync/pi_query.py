#!/usr/bin/env python3
"""
PI Query Bridge — CLI for Next.js API routes to call PI Web API.

Spawned by Next.js via: python sync/pi_query.py <command> --json-args <base64>

Commands:
  health        — Check PI Web API connectivity
  search        — Search PI Points by name filter
  recorded      — Get recorded (compressed) values
  interpolated  — Get interpolated values at interval
  summary       — Get server-calculated summary values (daily avg, min, max)

Output: JSON on stdout. Errors: {"status": "error", "message": "..."}
"""

import argparse
import base64
import json
import logging
import os
import sys
import time
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

# Add parent dir to path so we can import the PI client
sys.path.insert(0, str(Path(__file__).parent))

from pi_web_api_client import PIWebAPIClient
from dotenv import load_dotenv

# Load .env from project root
load_dotenv(Path(__file__).parent.parent / '.env')

logger = logging.getLogger('pi_query')


def get_client() -> PIWebAPIClient:
    """Create a PI Web API client from env vars."""
    base_url = os.environ.get('PI_WEB_API_URL', '')
    if not base_url:
        raise ValueError('PI_WEB_API_URL not set in environment')
    verify_ssl = os.environ.get('PI_VERIFY_SSL', 'false').lower() == 'true'
    return PIWebAPIClient(base_url, verify_ssl=verify_ssl)


def normalize_timestamp(ts_str: str) -> str:
    """Normalize a PI timestamp to YYYY-MM-DD local date."""
    # PI returns ISO format like "2025-01-15T14:30:00Z" or "2025-01-15T14:30:00-06:00"
    if not ts_str:
        return ''
    # Strip the time portion — take just the date
    return ts_str[:10]


def extract_items(stream_data: dict) -> list:
    """Extract value items from a PI stream response, normalizing timestamps."""
    items = stream_data.get('Items', [])
    result = []
    for item in items:
        ts = item.get('Timestamp', '')
        value = item.get('Value')
        good = item.get('Good', True)

        # Skip system digital states (dict values like {"Name": "Shutdown", ...})
        if isinstance(value, dict):
            continue

        # Skip non-numeric values
        if not isinstance(value, (int, float)):
            continue

        result.append({
            'timestamp': normalize_timestamp(ts),
            'value': value,
            'good': good,
        })
    return result


def aggregate_to_daily(items: list) -> list:
    """For recorded mode: collapse multiple values per day to last-value-of-day."""
    by_date = {}
    for item in items:
        date = item['timestamp']
        # Last value wins (items are chronologically ordered)
        by_date[date] = item
    return sorted(by_date.values(), key=lambda x: x['timestamp'])


def cmd_health(client: PIWebAPIClient, _args: dict) -> dict:
    """Health check — verify PI Web API connectivity."""
    info = client.health_check()
    return {
        'status': 'ok',
        'command': 'health',
        'server': {
            'product': info.get('ProductTitle', 'Unknown'),
            'version': info.get('ProductVersion', 'Unknown'),
        },
    }


def cmd_search(client: PIWebAPIClient, args: dict) -> dict:
    """Search PI Points by name filter."""
    server_webid = args.get('server_webid', os.environ.get('PI_SERVER_WEBID', ''))
    name_filter = args.get('name_filter', '*')
    max_count = args.get('max_count', 100)

    if not server_webid:
        raise ValueError('server_webid required (set PI_SERVER_WEBID env var or pass in args)')

    points = client.search_pi_points(
        server_webid,
        name_filter=name_filter,
        max_count=max_count,
        selected_fields=['Items.Name', 'Items.WebId', 'Items.PointType', 'Items.EngineeringUnits', 'Items.Descriptor'],
    )

    return {
        'status': 'ok',
        'command': 'search',
        'count': len(points),
        'points': [
            {
                'name': p.get('Name', ''),
                'web_id': p.get('WebId', ''),
                'point_type': p.get('PointType', ''),
                'engineering_units': p.get('EngineeringUnits', ''),
                'descriptor': p.get('Descriptor', ''),
            }
            for p in points
        ],
    }


def cmd_recorded(client: PIWebAPIClient, args: dict) -> dict:
    """Get recorded (compressed) values for tags."""
    webids = args.get('webids', [])
    start_time = args.get('start_time', '*-30d')
    end_time = args.get('end_time', '*')

    if not webids:
        raise ValueError('webids list required')

    t0 = time.time()
    streams = client.get_bulk_recorded_data(
        webids, start_time, end_time,
        selected_fields=['Items.WebId', 'Items.Name', 'Items.Items.Timestamp',
                         'Items.Items.Value', 'Items.Items.Good'],
    )

    tags = {}
    for wid in webids:
        stream = streams.get(wid, {})
        items = extract_items(stream)
        # Aggregate to daily (last value per day)
        daily = aggregate_to_daily(items)
        tags[wid] = {
            'name': stream.get('Name', ''),
            'web_id': wid,
            'items': daily,
        }

    return {
        'status': 'ok',
        'command': 'recorded',
        'query_time_ms': round((time.time() - t0) * 1000),
        'tags': tags,
    }


def cmd_interpolated(client: PIWebAPIClient, args: dict) -> dict:
    """Get interpolated values at regular intervals."""
    webids = args.get('webids', [])
    start_time = args.get('start_time', '*-30d')
    end_time = args.get('end_time', '*')
    interval = args.get('interval', '1d')

    if not webids:
        raise ValueError('webids list required')

    t0 = time.time()
    streams = client.get_bulk_interpolated_data(
        webids, start_time, end_time, interval,
        selected_fields=['Items.WebId', 'Items.Name', 'Items.Items.Timestamp',
                         'Items.Items.Value', 'Items.Items.Good'],
    )

    tags = {}
    for wid in webids:
        stream = streams.get(wid, {})
        items = extract_items(stream)
        tags[wid] = {
            'name': stream.get('Name', ''),
            'web_id': wid,
            'items': items,
        }

    return {
        'status': 'ok',
        'command': 'interpolated',
        'query_time_ms': round((time.time() - t0) * 1000),
        'tags': tags,
    }


def cmd_summary(client: PIWebAPIClient, args: dict) -> dict:
    """Get server-calculated summary values (time-weighted averages, etc.)."""
    webids = args.get('webids', [])
    start_time = args.get('start_time', '*-30d')
    end_time = args.get('end_time', '*')
    interval = args.get('interval', '1d')
    summary_type = args.get('summary_type', 'Average')

    if not webids:
        raise ValueError('webids list required')

    t0 = time.time()

    # StreamSets summary endpoint — not in PIWebAPIClient, call directly
    chunks = PIWebAPIClient._chunk_webids(webids)
    all_streams = {}

    for chunk in chunks:
        params = [('webId', w) for w in chunk]
        params.append(('startTime', start_time))
        params.append(('endTime', end_time))
        params.append(('summaryType', summary_type))
        params.append(('summaryDuration', interval))
        params.append(('selectedFields',
                        'Items.WebId;Items.Name;Items.Items.Value.Timestamp;'
                        'Items.Items.Value.Value;Items.Items.Type'))

        url = f"{client.base_url}/streamsets/summary"
        resp = client.session.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()

        for item in data.get('Items', []):
            wid = item.get('WebId')
            if wid:
                all_streams[wid] = item

    tags = {}
    for wid in webids:
        stream = all_streams.get(wid, {})
        summary_items = stream.get('Items', [])
        items = []
        for si in summary_items:
            # Summary response nests value inside Value.Value
            val_obj = si.get('Value', {})
            ts = val_obj.get('Timestamp', '')
            value = val_obj.get('Value')

            if isinstance(value, dict) or not isinstance(value, (int, float)):
                continue

            items.append({
                'timestamp': normalize_timestamp(ts),
                'value': value,
                'good': True,
            })

        tags[wid] = {
            'name': stream.get('Name', ''),
            'web_id': wid,
            'items': items,
        }

    return {
        'status': 'ok',
        'command': 'summary',
        'query_time_ms': round((time.time() - t0) * 1000),
        'tags': tags,
    }


COMMANDS = {
    'health': cmd_health,
    'search': cmd_search,
    'recorded': cmd_recorded,
    'interpolated': cmd_interpolated,
    'summary': cmd_summary,
}


def main():
    parser = argparse.ArgumentParser(description='PI Query Bridge for Next.js')
    parser.add_argument('command', choices=COMMANDS.keys(), help='Command to execute')
    parser.add_argument('--json-args', default='', help='Base64-encoded JSON arguments')
    parser.add_argument('--debug', action='store_true', help='Enable debug logging')

    parsed = parser.parse_args()

    # Setup logging to stderr only
    level = logging.DEBUG if parsed.debug else logging.WARNING
    logging.basicConfig(
        level=level,
        format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
        stream=sys.stderr,
    )

    # Decode args
    args = {}
    if parsed.json_args:
        try:
            decoded = base64.b64decode(parsed.json_args)
            args = json.loads(decoded)
        except Exception as e:
            print(json.dumps({'status': 'error', 'message': f'Failed to decode args: {e}'}))
            sys.exit(1)

    # Execute command
    try:
        with get_client() as client:
            handler = COMMANDS[parsed.command]
            result = handler(client, args)
            print(json.dumps(result))
    except Exception as e:
        logger.exception('Command failed')
        print(json.dumps({'status': 'error', 'message': str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
