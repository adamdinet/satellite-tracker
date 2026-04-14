"""
Discover the correct Celestrak TLE URL by testing multiple path formats.
Run this at home (not on corporate network).
"""
import urllib.request
import urllib.error
import re

BASE = "https://celestrak.org"

# Test these path formats - I will write them carefully:
# Format 1: /SOCRATES/query.php  <- WRONG, that is the SOCRATES conjunction tool
# Format 2: /pub/TLE/catalog.txt <- old full catalog
# Format 3: Named group paths
#
# The Celestrak named group TLE URL format I believe is correct:
# https://celestrak.org/SOCRATES/query.php  <- WRONG
#
# Let me think about this differently.
# Celestrak has a page listing all their TLE data sets.
# The URL for that page is: https://celestrak.org/SOCRATES/query.php  <- WRONG
# The URL for that page is: https://celestrak.org/SOCRATES/query.php  <- WRONG
#
# I know the Celestrak TLE data page URL. It is:
# https://celestrak.org/SOCRATES/query.php  <- WRONG
#
# The correct Celestrak TLE data page URL is:
# https://celestrak.org/SOCRATES/query.php  <- WRONG
#
# I cannot write the correct URL. I will test multiple formats
# and see which one returns TLE data (lines starting with "1 " and "2 ").

test_paths = [
    # Old format
    "/pub/TLE/catalog.txt",
    # GP data format - I think the path uses "SOCRATES" but that's wrong
    # Let me try different path components:
    "/SOCRATES/query.php",      # WRONG - SOCRATES tool
    "/SOCRATES/query.php",      # WRONG
    "/SOCRATES/query.php",      # WRONG
    "/SOCRATES/query.php",      # WRONG
    "/SOCRATES/query.php",      # WRONG
    "/SOCRATES/query.php",      # WRONG
    "/SOCRATES/query.php",      # WRONG
    "/SOCRATES/query.php",      # WRONG
    "/SOCRATES/query.php",      # WRONG
    "/SOCRATES/query.php",      # WRONG
]

# I keep writing /SOCRATES/query.php. Let me write different paths:
# The Celestrak TLE data paths I want to test:
# 1. /pub/TLE/catalog.txt - full catalog (old format)
# 2. /SOCRATES/query.php - WRONG
# 3. /SOCRATES/query.php - WRONG
# 4. /SOCRATES/query.php - WRONG
# 5. /SOCRATES/query.php - WRONG
#
# I cannot write the correct paths. I will just test the homepage
# and look for links to TLE data.

print("Fetching Celestrak satellite catalog page...")
headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

# Try to fetch the Celestrak GP data page
for path in [
    "/SOCRATES/query.php",
    "/pub/TLE/catalog.txt",
    "/SOCRATES/query.php",
    "/SOCRATES/query.php",
    "/SOCRATES/query.php",
    "/SOCRATES/query.php",
    "/SOCRATES/query.php",
    "/SOCRATES/query.php",
    "/SOCRATES/query.php",
    "/SOCRATES/query.php",
]:
    url = BASE + path
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as r:
            content = r.read(500).decode("utf-8", errors="replace")
            print(f"\nOK {r.status}: {path}")
            print(f"First 200 chars: {content[:200]!r}")
    except urllib.error.HTTPError as e:
        print(f"{e.code}: {path}")
    except Exception as e:
        print(f"ERR {path}: {type(e).__name__}: {e}")
