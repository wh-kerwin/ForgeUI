// Forge UI is a graphical desktop client. Keep the Windows subsystem set for
// debug and release so launching the executable never opens a console window.
#![cfg_attr(windows, windows_subsystem = "windows")]

fn main() {
    app_lib::run();
}
