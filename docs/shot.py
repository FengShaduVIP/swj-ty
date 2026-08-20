import os, time, sys
from playwright.sync_api import sync_playwright

CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Users\PC\AppData\Local\ms-playwright\chromium-930007\chrome-win\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
]
URL = "http://127.0.0.1:5180/"
OUT = r"E:\CodeBuddy\swj-ty\docs\shots"
os.makedirs(OUT, exist_ok=True)

VIEWS = [
    ("设备连接", "01-设备连接.png"),
    ("实时监测", "02-实时监测.png"),
    ("参数配置", "03-参数配置.png"),
    ("设备控制", "04-设备控制.png"),
]

def find_exe():
    for c in CANDIDATES:
        if os.path.exists(c):
            return c
    return None

def main():
    exe = find_exe()
    print("chrome exe:", exe)
    if not exe:
        print("NO CHROME FOUND"); sys.exit(2)
    with sync_playwright() as p:
        browser = None
        last_err = None
        for attempt in (exe,):
            try:
                browser = p.chromium.launch(
                    executable_path=attempt, headless=True,
                    args=["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"])
                break
            except Exception as e:
                last_err = e
                print("launch failed:", e)
        if browser is None:
            print("ALL LAUNCH FAILED:", last_err); sys.exit(3)

        page = browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
        page.goto(URL, wait_until="networkidle", timeout=60000)
        page.wait_for_selector(".rail-item", timeout=30000)
        try:
            page.evaluate("document.fonts && document.fonts.ready")
        except Exception:
            pass
        time.sleep(1.5)

        for label, fname in VIEWS:
            try:
                page.click(f".rail-item:has-text('{label}')", timeout=15000)
            except Exception as e:
                print(f"click {label} failed:", e)
            time.sleep(1.8)
            path = os.path.join(OUT, fname)
            page.screenshot(path=path, full_page=True)
            print("saved", fname, os.path.getsize(path), "bytes")
        browser.close()
    print("DONE")

if __name__ == "__main__":
    main()
