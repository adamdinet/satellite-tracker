import http.server
import urllib.parse
import os
import requests

PORT = int(os.environ.get('PORT', 10000))

GROUP_MAP = {
    "stations": "stations", "starlink": "starlink", "gps": "gps-ops",
    "weather": "weather", "military": "military", "science": "science",
    "amateur": "amateur", "debris": "1999-025",
}

# Real GPS fallback data
FALLBACK_DATA = b"""NAVSTAR 43 (USA 132)
1 24876U 97035A   24115.54131580 -.00000030  00000-0  00000-0 0  9997
2 24876  54.6738 101.9965 0108781 216.5186 142.9463  2.00565860193132
NAVSTAR 46 (USA 145)
1 25933U 99055A   24115.42674381 -.00000010  00000-0  00000-0 0  9997
2 25933  53.5185  99.8278 0134015 152.1287 208.5727  2.00564619179920
"""

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args): pass

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        if parsed.path in ('/', '/index.html'): self._serve_file('index.html', 'text/html')
        elif parsed.path == '/app.js': self._serve_file('app.js', 'application/javascript')
        elif parsed.path == '/tle': self._serve_tle(params.get('group', ['gps'])[0])
        else: self.send_error(404)

    def _serve_file(self, name, ctype):
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), name)
        if not os.path.exists(path): self.send_error(404); return
        with open(path, 'rb') as f: data = f.read()
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(data)

    def _serve_tle(self, group):
        g = GROUP_MAP.get(group, group)
        url = f"https://celestrak.org/NORAD/elements/gp.php?GROUP={g}&FORMAT=tle"
        headers = {'User-Agent': 'Mozilla/5.0'}
        try:
            r = requests.get(url, headers=headers, timeout=10)
            success = r.status_code == 200 and '1 ' in r.text
            data = r.content if success else FALLBACK_DATA
        except: data = FALLBACK_DATA
        
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(data)

def main():
    server = http.server.HTTPServer(('0.0.0.0', PORT), Handler)
    print(f"Server listening on {PORT}")
    server.serve_forever()

if __name__ == '__main__': main()
