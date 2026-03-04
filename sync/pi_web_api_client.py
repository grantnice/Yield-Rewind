#!/usr/bin/env python3
"""
PI Web API Client for Yield-Rewind

High-performance client for OSIsoft/AVEVA PI Web API with:
  - Windows SSO via requests-negotiate-sspi (NTLM/Kerberos over IP)
  - WebID 2.0 client-side generation (no server roundtrips)
  - StreamSets bulk retrieval with automatic chunking
  - Batch operations with JSONPath references
  - selectedFields filtering to minimize payload size

Usage:
  from sync.pi_web_api_client import PIWebAPIClient

  with PIWebAPIClient("https://10.x.x.x/piwebapi") as client:
      servers = client.get_data_servers()
      data = client.get_bulk_recorded_data(webids, "*-1d", "*")
"""

import base64
import logging
import os
import struct
import uuid
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import urlencode

import requests
from requests.adapters import HTTPAdapter
from requests_negotiate_sspi import HttpNegotiateAuth
from urllib3.util.retry import Retry

try:
    from urllib3.exceptions import InsecureRequestWarning
    import urllib3
except ImportError:
    InsecureRequestWarning = None

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# --- Constants ---
MAX_WEBIDS_PER_CHUNK = 400
MAX_URL_LENGTH = 7500


class PIWebAPIClient:
    """Client for AVEVA PI Web API with SSPI authentication and bulk operations."""

    def __init__(self, base_url: str, verify_ssl: bool = False):
        """
        Initialize the PI Web API client.

        Args:
            base_url: PI Web API root URL (e.g. https://10.x.x.x/piwebapi)
            verify_ssl: Whether to verify SSL certificates. Defaults to False
                        for IP-based access where certs typically don't match.
        """
        self.base_url = base_url.rstrip('/')
        self.verify_ssl = verify_ssl

        if not verify_ssl and InsecureRequestWarning:
            urllib3.disable_warnings(InsecureRequestWarning)

        self.session = requests.Session()
        self.session.verify = verify_ssl
        self.session.auth = HttpNegotiateAuth()
        self.session.headers.update({
            'X-Requested-With': 'XmlHttpRequest',
            'Accept': 'application/json',
        })

        retry_strategy = Retry(
            total=3,
            backoff_factor=1.0,
            status_forcelist=[429, 500, 502, 503, 504],
        )
        adapter = HTTPAdapter(
            max_retries=retry_strategy,
            pool_connections=10,
            pool_maxsize=20,
        )
        self.session.mount('https://', adapter)
        self.session.mount('http://', adapter)

        logger.info("PIWebAPIClient initialized for %s (ssl_verify=%s)", base_url, verify_ssl)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
        return False

    # ------------------------------------------------------------------ #
    #  Core HTTP
    # ------------------------------------------------------------------ #

    def _get(self, endpoint: str, params: Optional[dict] = None,
             selected_fields: Optional[List[str]] = None) -> dict:
        """
        GET request with optional selectedFields injection.

        Args:
            endpoint: API path relative to base_url (e.g. "/dataservers")
            params: Additional query parameters
            selected_fields: List of field paths to include in response.
                             Joined with semicolons per AVEVA convention.

        Returns:
            Parsed JSON response as dict.

        Raises:
            requests.HTTPError: On non-2xx responses.
        """
        url = f"{self.base_url}{endpoint}"
        if params is None:
            params = {}
        if selected_fields:
            params['selectedFields'] = ';'.join(selected_fields)

        logger.debug("GET %s params=%s", url, params)
        resp = self.session.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()
        logger.debug("GET %s -> %d bytes", url, len(resp.content))
        return data

    def _post(self, endpoint: str, json_body: Optional[dict] = None,
              params: Optional[dict] = None) -> requests.Response:
        """
        POST request returning the raw Response.

        Returns raw Response so callers can handle 207 Multi-Status
        from batch endpoints.

        Args:
            endpoint: API path relative to base_url
            json_body: JSON payload
            params: Query parameters

        Returns:
            Raw requests.Response object.
        """
        url = f"{self.base_url}{endpoint}"
        logger.debug("POST %s", url)
        resp = self.session.post(url, json=json_body, params=params)
        logger.debug("POST %s -> %d", url, resp.status_code)
        return resp

    # ------------------------------------------------------------------ #
    #  WebID 2.0 Generation (static, no server calls)
    # ------------------------------------------------------------------ #

    @staticmethod
    def _encode_guid_to_webid(guid_str: str) -> str:
        """
        Encode a GUID string into WebID 2.0 format.

        PI Web API uses Microsoft mixed-endian byte ordering:
        the first 3 groups of the GUID are byte-reversed, the last 2 are not.

        Args:
            guid_str: Standard GUID string (e.g. "f5be93a0-1234-5678-9abc-def012345678")

        Returns:
            22-character base64url-encoded string (no padding).
        """
        u = uuid.UUID(guid_str)
        # UUID.bytes_le gives Microsoft mixed-endian ordering
        encoded = base64.b64encode(u.bytes_le).decode('ascii')
        # Strip '==' padding, replace +/ with -_
        return encoded.replace('+', '-').replace('/', '_').rstrip('=')

    @staticmethod
    def _encode_path_to_webid(path: str) -> str:
        """
        Encode a PI path into WebID 2.0 format.

        Path is uppercased for case-insensitive matching, then
        base64url-encoded without padding.

        Args:
            path: PI object path (e.g. "\\\\SERVER\\tagname")

        Returns:
            Base64url-encoded string (no padding).
        """
        normalized = path.upper()
        raw = normalized.encode('utf-8')
        encoded = base64.b64encode(raw).decode('ascii')
        return encoded.replace('+', '-').replace('/', '_').rstrip('=')

    @staticmethod
    def generate_webid_from_path(path: str, marker: str,
                                 owner_id: Optional[str] = None) -> str:
        """
        Generate a full WebID 2.0 string from a PI path.

        WebID structure: marker + encoded_owner_guid + encoded_path

        Marker reference:
            P1 = DataServer
            DP = PIPoint
            Em = Element
            Ab = Attribute

        Args:
            path: Full PI path (e.g. "\\\\SERVER\\sinusoid")
            marker: WebID type marker (e.g. "DP" for PIPoint)
            owner_id: Optional owner GUID (e.g. DataServer GUID for PIPoints)

        Returns:
            Complete WebID 2.0 string.
        """
        parts = [marker]
        if owner_id:
            parts.append(PIWebAPIClient._encode_guid_to_webid(owner_id))
        parts.append(PIWebAPIClient._encode_path_to_webid(path))
        return ''.join(parts)

    # ------------------------------------------------------------------ #
    #  Discovery
    # ------------------------------------------------------------------ #

    def get_data_servers(self, selected_fields: Optional[List[str]] = None) -> List[dict]:
        """
        List all PI Data Archive servers.

        Args:
            selected_fields: Optional field filter (e.g. ["Items.Name", "Items.WebId"])

        Returns:
            List of server objects.
        """
        data = self._get('/dataservers', selected_fields=selected_fields)
        return data.get('Items', [])

    def search_pi_points(self, server_webid: str, name_filter: str = '*',
                         max_count: int = 1000,
                         selected_fields: Optional[List[str]] = None) -> List[dict]:
        """
        Search PI Points on a Data Server with auto-pagination.

        Repeatedly queries with increasing startIndex until all matching
        points are retrieved.

        Args:
            server_webid: WebID of the PI Data Archive server
            name_filter: Wildcard filter for point names (e.g. "FCC*")
            max_count: Page size per request (max 1000)
            selected_fields: Optional field filter

        Returns:
            Flat list of all matching PI Point objects.
        """
        all_points = []
        start_index = 0

        while True:
            params = {
                'nameFilter': name_filter,
                'maxCount': max_count,
                'startIndex': start_index,
            }
            data = self._get(
                f'/dataservers/{server_webid}/points',
                params=params,
                selected_fields=selected_fields,
            )
            items = data.get('Items', [])
            if not items:
                break
            all_points.extend(items)
            if len(items) < max_count:
                break
            start_index += len(items)
            logger.info("Paginating PI Points: %d so far...", len(all_points))

        logger.info("Found %d PI Points matching '%s'", len(all_points), name_filter)
        return all_points

    # ------------------------------------------------------------------ #
    #  StreamSets Bulk Retrieval
    # ------------------------------------------------------------------ #

    @staticmethod
    def _chunk_webids(webids: List[str]) -> List[List[str]]:
        """
        Split WebIDs into chunks respecting both count and URL length limits.

        Dual guard:
          1. MAX_WEBIDS_PER_CHUNK (400) - AVEVA server limit
          2. MAX_URL_LENGTH (7500 bytes) - practical URL length limit

        Args:
            webids: List of WebID strings

        Returns:
            List of WebID chunks, each safe for a single request.
        """
        chunks = []
        current_chunk = []
        current_url_len = 0
        # Base overhead for "webId=" param key + "&"
        param_overhead = len('&webId=')

        for wid in webids:
            entry_len = param_overhead + len(wid)

            if current_chunk and (
                len(current_chunk) >= MAX_WEBIDS_PER_CHUNK
                or current_url_len + entry_len > MAX_URL_LENGTH
            ):
                chunks.append(current_chunk)
                current_chunk = []
                current_url_len = 0

            current_chunk.append(wid)
            current_url_len += entry_len

        if current_chunk:
            chunks.append(current_chunk)

        return chunks

    def get_bulk_recorded_data(self, webids: List[str],
                               start_time: str, end_time: str,
                               selected_fields: Optional[List[str]] = None
                               ) -> Dict[str, dict]:
        """
        Retrieve recorded (compressed) data for multiple tags via StreamSets.

        Automatically chunks WebIDs and merges results.

        Args:
            webids: List of PI Point WebIDs
            start_time: PI time expression (e.g. "*-1d", "2024-01-01T00:00:00Z")
            end_time: PI time expression (e.g. "*", "2024-01-02T00:00:00Z")
            selected_fields: Optional field filter

        Returns:
            Dict keyed by WebID, each value containing the stream's recorded data.
        """
        chunks = self._chunk_webids(webids)
        merged = {}

        for i, chunk in enumerate(chunks):
            logger.info("Fetching recorded data chunk %d/%d (%d WebIDs)",
                        i + 1, len(chunks), len(chunk))

            params = [('webId', w) for w in chunk]
            params.append(('startTime', start_time))
            params.append(('endTime', end_time))

            if selected_fields:
                params.append(('selectedFields', ';'.join(selected_fields)))

            url = f"{self.base_url}/streamsets/recorded"
            resp = self.session.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()

            for item in data.get('Items', []):
                wid = item.get('WebId')
                if wid:
                    merged[wid] = item

        logger.info("Recorded data: %d streams retrieved", len(merged))
        return merged

    def get_bulk_interpolated_data(self, webids: List[str],
                                   start_time: str, end_time: str,
                                   interval: str,
                                   selected_fields: Optional[List[str]] = None
                                   ) -> Dict[str, dict]:
        """
        Retrieve interpolated data for multiple tags via StreamSets.

        Args:
            webids: List of PI Point WebIDs
            start_time: PI time expression
            end_time: PI time expression
            interval: Interpolation interval (e.g. "1h", "10m")
            selected_fields: Optional field filter

        Returns:
            Dict keyed by WebID, each value containing the stream's interpolated data.
        """
        chunks = self._chunk_webids(webids)
        merged = {}

        for i, chunk in enumerate(chunks):
            logger.info("Fetching interpolated data chunk %d/%d (%d WebIDs)",
                        i + 1, len(chunks), len(chunk))

            params = [('webId', w) for w in chunk]
            params.append(('startTime', start_time))
            params.append(('endTime', end_time))
            params.append(('interval', interval))

            if selected_fields:
                params.append(('selectedFields', ';'.join(selected_fields)))

            url = f"{self.base_url}/streamsets/interpolated"
            resp = self.session.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()

            for item in data.get('Items', []):
                wid = item.get('WebId')
                if wid:
                    merged[wid] = item

        logger.info("Interpolated data: %d streams retrieved", len(merged))
        return merged

    # ------------------------------------------------------------------ #
    #  Batch Operations
    # ------------------------------------------------------------------ #

    def execute_batch(self, batch_request: dict) -> dict:
        """
        Execute a PI Web API batch request.

        The batch endpoint accepts a dict of numbered sub-requests, each with
        Method, Resource, and optional ParentIds/Parameters. The server resolves
        JSONPath references (e.g. "$.1.Content.WebId") between sub-requests.

        Args:
            batch_request: Dict of sub-requests. Example:
                {
                    "1": {
                        "Method": "GET",
                        "Resource": "https://server/piwebapi/points?nameFilter=sinusoid"
                    },
                    "2": {
                        "Method": "GET",
                        "Resource": "https://server/piwebapi/streams/{0}/recorded",
                        "ParentIds": ["1"],
                        "Parameters": ["$.1.Content.Items[*].WebId"]
                    }
                }

        Returns:
            Dict of batch results keyed by sub-request ID.

        Raises:
            requests.HTTPError: On non-2xx/207 responses.
        """
        resp = self._post('/batch', json_body=batch_request)

        if resp.status_code not in (200, 207):
            resp.raise_for_status()

        results = resp.json()

        # Log warnings for failed sub-requests
        for req_id, result in results.items():
            status = result.get('Status', 0)
            if status >= 400:
                logger.warning(
                    "Batch sub-request '%s' failed with status %d: %s",
                    req_id, status, result.get('Content', '')
                )

        return results

    # ------------------------------------------------------------------ #
    #  Utilities
    # ------------------------------------------------------------------ #

    def health_check(self) -> dict:
        """
        Check PI Web API connectivity by hitting the root endpoint.

        Returns:
            Server info dict with Links, ProductTitle, etc.

        Raises:
            requests.HTTPError: If server is unreachable or auth fails.
        """
        data = self._get('/')
        logger.info("PI Web API health check OK: %s", data.get('ProductTitle', 'unknown'))
        return data

    def close(self):
        """Close the underlying HTTP session."""
        self.session.close()
        logger.info("PIWebAPIClient session closed")


# ---------------------------------------------------------------------- #
#  __main__ example
# ---------------------------------------------------------------------- #

if __name__ == '__main__':
    # Load .env from project root
    env_path = Path(__file__).parent.parent / '.env'
    load_dotenv(env_path)

    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    )

    base_url = os.environ.get('PI_WEB_API_URL', '')
    verify_ssl = os.environ.get('PI_VERIFY_SSL', 'false').lower() == 'true'

    import sys

    if not base_url:
        print("Set PI_WEB_API_URL in .env to run this example.")
        print("Example: PI_WEB_API_URL=https://10.x.x.x/piwebapi")
        sys.exit(1)

    with PIWebAPIClient(base_url, verify_ssl=verify_ssl) as client:
        # 1. Health check
        print("\n--- Health Check ---")
        info = client.health_check()
        print(f"Product: {info.get('ProductTitle', 'N/A')}")

        # 2. List data servers
        print("\n--- Data Servers ---")
        servers = client.get_data_servers(
            selected_fields=['Items.Name', 'Items.WebId', 'Items.Id']
        )
        for s in servers:
            print(f"  {s.get('Name')} -> WebID: {s.get('WebId')}")

        if not servers:
            print("No servers found. Exiting.")
            sys.exit(0)

        server = servers[0]
        server_webid = server['WebId']

        # 3. Search PI Points
        print("\n--- Search PI Points (first 10) ---")
        points = client.search_pi_points(
            server_webid,
            name_filter='sinu*',
            max_count=10,
            selected_fields=['Items.Name', 'Items.WebId'],
        )
        for p in points:
            print(f"  {p.get('Name')} -> {p.get('WebId')}")

        # 4. Bulk recorded data
        if points:
            print("\n--- Bulk Recorded Data (last 1 hour) ---")
            webids = [p['WebId'] for p in points[:5]]
            recorded = client.get_bulk_recorded_data(webids, '*-1h', '*')
            for wid, stream in recorded.items():
                items = stream.get('Items', [])
                print(f"  {wid[:20]}... -> {len(items)} values")

        # 5. WebID generation example
        print("\n--- WebID 2.0 Generation ---")
        if servers and 'Id' in server:
            test_path = f"\\\\{server.get('Name', 'SERVER')}\\sinusoid"
            webid = PIWebAPIClient.generate_webid_from_path(
                test_path, 'DP', owner_id=server['Id']
            )
            print(f"  Path: {test_path}")
            print(f"  Generated WebID: {webid}")

        # 6. Batch operation example
        print("\n--- Batch Operation ---")
        batch_req = {
            "1": {
                "Method": "GET",
                "Resource": f"{base_url}/dataservers",
            }
        }
        batch_result = client.execute_batch(batch_req)
        for rid, res in batch_result.items():
            print(f"  Request {rid}: status={res.get('Status')}")

    print("\nDone.")
