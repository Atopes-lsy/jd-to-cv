"""Windows entry point; no API credential is bundled."""
import sys
import threading
import tempfile
import urllib.request
import webbrowser
import tkinter as tk
from tkinter import messagebox, ttk
from pathlib import Path

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from desktop.server import make_server


def main():
    if '--smoke-test' in sys.argv:
        with tempfile.TemporaryDirectory() as directory:
            server = make_server(0, Path(directory), sponsored_key='')
            worker = threading.Thread(target=server.serve_forever, daemon=True); worker.start()
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{server.server_port}/') as response:
                    assert '拖入岗位截图' in response.read().decode('utf-8')
            finally:
                server.shutdown(); server.server_close(); worker.join()
        return 0
    window = tk.Tk()
    window.title('JD to CV · 本地桌面入口')
    window.geometry('540x350')
    window.configure(background='#f3f6f9')
    try:
        server = make_server(8766)
    except OSError:
        window.withdraw()
        messagebox.showwarning('无法启动', '端口 8766 已被占用。请检查是否已启动 JD to CV，或关闭占用该端口的程序。')
        window.destroy()
        return 1
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = 'http://127.0.0.1:8766'
    frame = ttk.Frame(window, padding=26); frame.pack(fill='both', expand=True)
    ttk.Label(frame, text='JD to CV 正在本机运行', font=('Microsoft YaHei', 17, 'bold')).pack(anchor='w', pady=(0, 16))
    ttk.Label(frame, text='工具已在默认浏览器打开。\n\n截图拖入、API Key 配置、岗位库与简历预览使用同一界面。\n个人资料保存在当前浏览器，请定期导出备份。\n\n保持本窗口开启即可使用；关闭窗口会停止本地服务。', wraplength=480, font=('Microsoft YaHei', 10)).pack(anchor='w', pady=(0, 20))
    ttk.Button(frame, text='打开工具', command=lambda: webbrowser.open(url)).pack(fill='x', pady=5)
    def close():
        server.shutdown(); window.destroy()
    ttk.Button(frame, text='退出并停止服务', command=close).pack(fill='x', pady=5)
    window.protocol('WM_DELETE_WINDOW', close)
    webbrowser.open(url)
    window.mainloop()
    server.server_close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
