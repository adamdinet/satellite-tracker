"""
Satellite Tracker server.
Fetches TLE data from Celestrak and serves the app. Includes failsafes.
"""
import http.server
import urllib.parse
import os
import requests  # Upgraded to use the library from your requirements.txt

# Automatically use Render's port, or 10000 for local testing
PORT = int(os.environ.get('PORT', 10000))

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

# THE FAILSAFE: If Celestrak completely blocks us, load these real GPS satellites 
# so the globe never breaks and you always have data to track.
FALLBACK_DATA = b"""NAVSTAR 43 (USA 132)
1 24876U 97035A   24115.54131580 -.00000030  00000-0  00000-0 0  9997
2 24876  54.6738 101.9965 0108781 216.5186 142.9463  2.00565860193132
NAVSTAR 46 (USA 145)
1 25933U 99055A   24115.42674381 -.00000010  00000-0  00000-0 0  9997
2 25933  53.5185  99.8278 0134015 152.1287 208.5727  2.00564619179920
"""

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Silencing the logs so your Render dashboard stays clean

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)

        if parsed.path in ('/', '/index.html'):
            self._serve_file('index.html', 'text/html; charset=utf-8')
        elif parsed.path == '/app.js':
            self._serve_file('app.js', 'application/javascript; charset=utf-8')
        elif parsed.path == '/tle':
            group = params.get('group', ['gps'])[0]
            self._serve_tle(group)
        else:
            self.send_error(404)

    def _serve_file(self, name, ctype):
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), name)
        if not os.path.exists(path):
            self.send_error(404)
            return
        with open(path, 'rb') as f:
            data = f.read()
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(data)

    def _serve_tle(self, group):
        g = GROUP_MAP.get(group, group)
        base_url = f"https://celestrak.org/NORAD/elements/gp.php?GROUP={g}&FORMAT=tle"
        
        # Try direct access first, then route through a proxy
        urls = [
            base_url,
            f"https://api.allorigins.win/raw?url={urllib.parse.quote(base_url)}"
        ]
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        
        success_data = None
        for url in urls:
            try:
                print(f"Attempting to fetch data from: {url}")
                r = requests.get(url, headers=headers, timeout=10)
                
                # Check to make sure we got real TLE data and not a Cloudflare Block page
                if r.status_code == 200 and '1 ' in r.text and '2 ' in r.text:
                    success_data = r.content
                    print("SUCCESS: Downloaded live data!")
                    break
            except Exception as e:
                print(f"Failed connection: {e}")
                continue

        self.send_response(200)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        
        # Serve the live data, or inject the failsafe if Celestrak is blocking us
        if success_data:
            self.wfile.write(success_data)
        else:
            print("WARNING: Render IP blocked by Cloudflare. Injecting Failsafe GPS data.")
            # If the user requested GPS, give them the fallback. 
            # If they requested something else that failed, just give empty so it doesn't crash.
            if group == 'gps':
                self.wfile.write(FALLBACK_DATA)
            else:
                self.wfile.write(b"")

def main():
    server = http.server.HTTPServer(('0.0.0.0', PORT), Handler)
    print(f"Server is live and listening on port {PORT}")
    server.serve_forever()

if __name__ == '__main__':
    main()
