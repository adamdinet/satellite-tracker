"""
Satellite Tracker server.
Fetches TLE data from Celestrak (via proxies to bypass Render blocks) and serves the app.
"""

import http.server
import urllib.request
import urllib.parse
import os

PORT = int(os.environ.get('PORT', 8765))

# Celestrak group name mapping
GROUP_MAP = {
    "stations": "stations",
    "starlink":  "starlink",
    "gps":       "gps-ops",
    "weather":   "weather",
    "military":  "military",
    "science":   "science",
    "amateur":   "amateur",
    "debris":    "1999-025",
}

def get_tle_urls(group_name):
    """Return URL formats to try, prioritizing proxies to bypass Render IP blocks."""
    # The actual correct modern Celestrak URL for TLE data
    base_url = f"https://celestrak.org/NORAD/elements/gp.php?GROUP={group_name}&FORMAT=tle"
    
    return [
        # Try a free public proxy first so Celestrak doesn't see Render's IP
        f"https://api.allorigins.win/raw?url={base_url}",
        # Try a secondary proxy just in case the first is down
        f"https://corsproxy.io/?{urllib.parse.quote(base_url)}",
        # Try direct access as a final fallback
        base_url
    ]

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"  [{self.address_string()}] {fmt % args}")

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)

        if parsed.path in ('/', '/index.html'):
            self._serve_file('index.html', 'text/html; charset=utf-8')
        elif parsed.path == '/app.js':
            self._serve_file('app.js', 'application/javascript; charset=utf-8')
        elif parsed.path == '/tle':
            group = params.get('group', ['stations'])[0]
            self._serve_tle(group)
        else:
            self.send_error(404)

    def _serve_file(self, name, ctype):
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), name)
        if not os.path.exists(path):
            self.send_error(404, f"File not found: {name}")
            return
        with open(path, 'rb') as f:
            data = f.read()
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(data)

    def _serve_tle(self, group):
        g = GROUP_MAP.get(group, group)
        urls = get_tle_urls(g)
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/plain,*/*',
        }

        for url in urls:
            print(f"  Trying: {url}")
            try:
                req = urllib.request.Request(url, headers=headers)
                with urllib.request.urlopen(req, timeout=20) as r:
                    data = r.read()
                text = data.decode('utf-8', errors='replace')
                lines = [l.strip() for l in text.split('\n') if l.strip()]
                tle_lines = [l for l in lines if l.startswith('1 ') or l.startswith('2 ')]
                if len(tle_lines) < 2:
                    print(f"  Not TLE data ({len(lines)} lines, {len(tle_lines)} TLE lines) — skipping")
                    continue
                sat_count = len(tle_lines) // 2
                print(f"  OK: {sat_count} satellites for '{group}' via {url}")
                self.send_response(200)
                self.send_header('Content-Type', 'text/plain; charset=utf-8')
                self.send_header('Content-Length', str(len(data)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(data)
                return
            except Exception as e:
                print(f"  FAIL: {type(e).__name__}: {e}")

        print(f"  ERROR: all URLs failed for group '{group}'")
        # Return empty response so the browser doesn't hang
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', '0')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

def main():
    import socket
    hostname = socket.gethostname()
    try:
        local_ip = socket.gethostbyname(hostname)
    except Exception:
        local_ip = '(run ipconfig to find your IP)'

    server = http.server.HTTPServer(('0.0.0.0', PORT), Handler)
    print(f"\n{'='*55}")
    print(f"  Satellite Tracker Server")
    print(f"  Running on port: {PORT}")
    print(f"{'='*55}\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")

if __name__ == '__main__':
    main()
