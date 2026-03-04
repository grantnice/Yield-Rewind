"""
Unit tests for PI Web API Client.

Run with: python -m pytest sync/tests/test_pi_web_api_client.py -v
"""

import base64
import os
import uuid

import pytest

from sync.pi_web_api_client import PIWebAPIClient, MAX_WEBIDS_PER_CHUNK, MAX_URL_LENGTH


# ------------------------------------------------------------------ #
#  WebID 2.0 Generation Tests
# ------------------------------------------------------------------ #

class TestWebIDGeneration:
    """Tests for client-side WebID 2.0 encoding."""

    def test_encode_guid_produces_22_chars(self):
        """GUID encoding should produce exactly 22 base64url characters."""
        guid = "f5be93a0-1234-5678-9abc-def012345678"
        result = PIWebAPIClient._encode_guid_to_webid(guid)
        assert len(result) == 22

    def test_encode_guid_no_padding(self):
        """Encoded GUID should have no base64 padding characters."""
        guid = "a0000000-0000-0000-0000-000000000001"
        result = PIWebAPIClient._encode_guid_to_webid(guid)
        assert '=' not in result

    def test_encode_guid_uses_base64url_chars(self):
        """Encoded GUID should only contain base64url-safe characters."""
        guid = "ffffffff-ffff-ffff-ffff-ffffffffffff"
        result = PIWebAPIClient._encode_guid_to_webid(guid)
        assert '+' not in result
        assert '/' not in result

    def test_encode_guid_mixed_endian_ordering(self):
        """Verify Microsoft mixed-endian byte ordering via uuid.bytes_le."""
        guid = "01020304-0506-0708-090a-0b0c0d0e0f10"
        result = PIWebAPIClient._encode_guid_to_webid(guid)
        # Decode back to verify byte order
        padded = result.replace('-', '+').replace('_', '/') + '=='
        raw_bytes = base64.b64decode(padded)
        # bytes_le reverses first 3 groups: 04030201-0605-0807
        assert raw_bytes[0] == 0x04  # first group reversed
        assert raw_bytes[1] == 0x03
        assert raw_bytes[2] == 0x02
        assert raw_bytes[3] == 0x01
        assert raw_bytes[4] == 0x06  # second group reversed
        assert raw_bytes[5] == 0x05
        assert raw_bytes[6] == 0x08  # third group reversed
        assert raw_bytes[7] == 0x07
        # Last two groups are NOT reversed
        assert raw_bytes[8] == 0x09
        assert raw_bytes[9] == 0x0a

    def test_encode_path_uppercase_normalization(self):
        """Path encoding should be case-insensitive (uppercased)."""
        path1 = "\\\\Server\\TagName"
        path2 = "\\\\SERVER\\TAGNAME"
        result1 = PIWebAPIClient._encode_path_to_webid(path1)
        result2 = PIWebAPIClient._encode_path_to_webid(path2)
        assert result1 == result2

    def test_encode_path_no_padding(self):
        """Encoded path should have no base64 padding characters."""
        path = "\\\\MYSERVER\\sinusoid"
        result = PIWebAPIClient._encode_path_to_webid(path)
        assert '=' not in result

    def test_encode_path_uses_base64url_chars(self):
        """Encoded path should only contain base64url-safe characters."""
        path = "\\\\SERVER\\some+tag/name"
        result = PIWebAPIClient._encode_path_to_webid(path)
        assert '+' not in result
        assert '/' not in result

    def test_encode_path_known_value(self):
        """Verify path encoding against a known value."""
        path = "\\\\A"
        result = PIWebAPIClient._encode_path_to_webid(path)
        # "\\A" uppercased = "\\A", UTF-8 bytes, base64url encoded
        expected_bytes = path.upper().encode('utf-8')
        expected = base64.b64encode(expected_bytes).decode('ascii')
        expected = expected.replace('+', '-').replace('/', '_').rstrip('=')
        assert result == expected

    def test_generate_webid_with_marker_only(self):
        """WebID with marker + path (no owner)."""
        path = "\\\\SERVER"
        webid = PIWebAPIClient.generate_webid_from_path(path, 'P1')
        assert webid.startswith('P1')
        # Should contain the encoded path
        encoded_path = PIWebAPIClient._encode_path_to_webid(path)
        assert webid == f'P1{encoded_path}'

    def test_generate_webid_with_owner(self):
        """WebID with marker + owner GUID + path."""
        path = "\\\\SERVER\\sinusoid"
        owner = "01020304-0506-0708-090a-0b0c0d0e0f10"
        webid = PIWebAPIClient.generate_webid_from_path(path, 'DP', owner_id=owner)
        assert webid.startswith('DP')
        encoded_owner = PIWebAPIClient._encode_guid_to_webid(owner)
        assert webid.startswith(f'DP{encoded_owner}')

    def test_generate_webid_case_insensitive(self):
        """Same path in different cases should produce identical WebIDs."""
        path_lower = "\\\\server\\tagname"
        path_upper = "\\\\SERVER\\TAGNAME"
        owner = "aabbccdd-eeff-0011-2233-445566778899"
        wid1 = PIWebAPIClient.generate_webid_from_path(path_lower, 'DP', owner_id=owner)
        wid2 = PIWebAPIClient.generate_webid_from_path(path_upper, 'DP', owner_id=owner)
        assert wid1 == wid2


# ------------------------------------------------------------------ #
#  Chunking Tests
# ------------------------------------------------------------------ #

class TestChunking:
    """Tests for WebID chunking logic."""

    def test_single_chunk_small_list(self):
        """A small list should produce exactly one chunk."""
        webids = [f"WebID_{i}" for i in range(10)]
        chunks = PIWebAPIClient._chunk_webids(webids)
        assert len(chunks) == 1
        assert chunks[0] == webids

    def test_empty_list(self):
        """Empty input should produce empty output."""
        chunks = PIWebAPIClient._chunk_webids([])
        assert chunks == []

    def test_exact_max_count(self):
        """Exactly MAX_WEBIDS_PER_CHUNK items should be one chunk."""
        webids = [f"W{i}" for i in range(MAX_WEBIDS_PER_CHUNK)]
        chunks = PIWebAPIClient._chunk_webids(webids)
        assert len(chunks) == 1
        assert len(chunks[0]) == MAX_WEBIDS_PER_CHUNK

    def test_splits_at_max_count(self):
        """MAX_WEBIDS_PER_CHUNK + 1 items should split into two chunks."""
        webids = [f"W{i}" for i in range(MAX_WEBIDS_PER_CHUNK + 1)]
        chunks = PIWebAPIClient._chunk_webids(webids)
        assert len(chunks) == 2
        assert len(chunks[0]) == MAX_WEBIDS_PER_CHUNK
        assert len(chunks[1]) == 1

    def test_large_list_multiple_chunks(self):
        """Large list should be split into multiple chunks."""
        webids = [f"W{i}" for i in range(1000)]
        chunks = PIWebAPIClient._chunk_webids(webids)
        assert len(chunks) >= 3
        total = sum(len(c) for c in chunks)
        assert total == 1000

    def test_url_length_limit_triggers_split(self):
        """Long WebIDs should trigger URL-length-based splitting."""
        # Create WebIDs that are each ~200 chars to blow past URL limit
        long_wid = "A" * 200
        # With ~7500 byte limit and ~207 bytes per entry (200 + "&webId="),
        # we should fit about 36 per chunk
        webids = [long_wid for _ in range(100)]
        chunks = PIWebAPIClient._chunk_webids(webids)
        assert len(chunks) > 1
        for chunk in chunks:
            chunk_url_len = sum(len(f"&webId={w}") for w in chunk)
            assert chunk_url_len <= MAX_URL_LENGTH

    def test_all_webids_preserved(self):
        """Chunking should preserve all WebIDs without loss or duplication."""
        webids = [f"WebID_{i:04d}" for i in range(850)]
        chunks = PIWebAPIClient._chunk_webids(webids)
        reconstituted = []
        for chunk in chunks:
            reconstituted.extend(chunk)
        assert reconstituted == webids


# ------------------------------------------------------------------ #
#  Selected Fields Tests
# ------------------------------------------------------------------ #

class TestSelectedFields:
    """Tests for selectedFields parameter handling."""

    def test_fields_joined_with_semicolons(self):
        """selectedFields should be joined with semicolons."""
        fields = ['Items.Name', 'Items.WebId', 'Items.Id']
        result = ';'.join(fields)
        assert result == 'Items.Name;Items.WebId;Items.Id'

    def test_none_fields_excluded(self):
        """None selectedFields should not add the parameter."""
        # This tests the logic pattern used in _get()
        params = {}
        selected_fields = None
        if selected_fields:
            params['selectedFields'] = ';'.join(selected_fields)
        assert 'selectedFields' not in params

    def test_empty_list_excluded(self):
        """Empty selectedFields list should not add the parameter."""
        params = {}
        selected_fields = []
        if selected_fields:
            params['selectedFields'] = ';'.join(selected_fields)
        assert 'selectedFields' not in params

    def test_single_field(self):
        """Single field should work without semicolons."""
        fields = ['Items.Name']
        result = ';'.join(fields)
        assert result == 'Items.Name'


# ------------------------------------------------------------------ #
#  Integration Test Stubs (skipped without PI server)
# ------------------------------------------------------------------ #

@pytest.mark.integration
class TestIntegration:
    """Integration tests requiring a live PI Web API server.

    These are skipped unless PI_WEB_API_URL is set in the environment.
    Run with: pytest -m integration
    """

    @pytest.fixture(autouse=True)
    def skip_without_server(self):
        url = os.environ.get('PI_WEB_API_URL')
        if not url:
            pytest.skip("PI_WEB_API_URL not set - skipping integration tests")

    @pytest.fixture
    def client(self):
        url = os.environ.get('PI_WEB_API_URL')
        verify = os.environ.get('PI_VERIFY_SSL', 'false').lower() == 'true'
        with PIWebAPIClient(url, verify_ssl=verify) as c:
            yield c

    def test_health_check(self, client):
        info = client.health_check()
        assert 'ProductTitle' in info

    def test_get_data_servers(self, client):
        servers = client.get_data_servers()
        assert isinstance(servers, list)
        assert len(servers) > 0

    def test_search_pi_points(self, client):
        servers = client.get_data_servers(
            selected_fields=['Items.WebId']
        )
        assert len(servers) > 0
        points = client.search_pi_points(
            servers[0]['WebId'],
            name_filter='sinu*',
            max_count=5,
        )
        assert isinstance(points, list)
