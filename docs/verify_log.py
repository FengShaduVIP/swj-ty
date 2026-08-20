import os, time
from playwright.sync_api import sync_playwright

EXE = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
URL = "http://127.0.0.1:5180/"
OUT = r"E:\CodeBuddy\swj-ty\docs\shots\05-下发记录.png"
os.makedirs(os.path.dirname(OUT), exist_ok=True)

errs = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=EXE, headless=True,
                          args=["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"])
    pg = b.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
    pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
    pg.goto(URL, wait_until="networkidle", timeout=60000)
    pg.wait_for_selector(".rail-item", timeout=30000)
    time.sleep(1.5)
    # 预先写入一条假记录，验证列表渲染
    pg.evaluate("""localStorage.setItem('jbd_dispatch_log_v1', JSON.stringify([{
      id:'test01', time: Date.now(),
      btName:'TEST_BMS_01',
      params:[{label:'额定充电电压',index:117,value:58.0},{label:'蓝牙名称',index:88,value:'TEST_BMS_01'}]
    }]))""")
    pg.reload(wait_until="networkidle")
    pg.wait_for_selector(".rail-item", timeout=30000)
    time.sleep(1.0)
    pg.click(".rail-item:has-text('下发记录')", timeout=15000)
    time.sleep(1.5)
    pg.screenshot(path=OUT, full_page=True)
    # 验证表格行数
    rows = pg.eval_on_selector_all(".el-table__row", "els => els.length")
    print("rows:", rows, "size:", os.path.getsize(OUT))
    b.close()
print("CONSOLE/PAGE ERRORS:", errs if errs else "none")
