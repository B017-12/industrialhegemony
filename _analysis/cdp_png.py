import base64, glob, json, os, sys
# Decode the newest CDP Page.captureScreenshot response into a PNG.
src = max(glob.glob(os.path.expanduser("~/.cursor/browser-logs/cdp-response-Page.captureScreenshot-*.json")), key=os.path.getmtime)
raw = json.load(open(src))
data = raw.get("data") or raw.get("result", {}).get("data")
open(sys.argv[1], "wb").write(base64.b64decode(data))
print(sys.argv[1], os.path.getsize(sys.argv[1]))
