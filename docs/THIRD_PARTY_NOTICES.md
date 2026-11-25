# Third-party components in the Windows distribution

JD to CV application source: MIT, copyright 2026 Atopes-lsy.

The desktop launcher uses Python 3.12 (PSF license), its tkinter bindings,
and Tcl/Tk (permissive Tcl/Tk licenses). The Python and Tcl/Tk license texts
are included with the runtime where supplied by the redistributor.
PyInstaller 6.16 uses GPL with the bootloader exception that permits
distribution of applications under their own licenses. No PySide6 or Qt
libraries are required by or bundled into this application.

- Python license: https://docs.python.org/3/license.html
- Tcl/Tk license: https://www.tcl-lang.org/software/tcltk/license.html
- PyInstaller license and exception: https://pyinstaller.org/en/stable/license.html

Dependencies retain their own license notices. Build instructions and the
pinned build dependency are in this repository. The application opens its
local interface in the user's existing browser; the browser is not bundled.
