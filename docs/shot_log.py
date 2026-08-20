import os, time
from playwright.sync_api import sync_playwright

EXE = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
URL = "http://127.0.0.1:5180/"
OUT = r"E:\CodeBuddy\swj-ty\docs\shots\05-下发记录.png"

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=EXE, headless=True,
                          args=["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"])
    pg = b.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
    pg.goto(URL, wait_until="networkidle", timeout=60000)
    pg.wait_for_selector(".rail-item", timeout=30000)
    time.sleep(1.5)
    pg.click(".rail-item:has-text('下发记录')", timeout=15000)
    time.sleep(1.5)
    pg.screenshot(path=OUT, full_page=True)
    print("saved", OUT, os.path.getsize(OUT))
    b.close()
