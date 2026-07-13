use serde::Serialize;
use std::sync::Mutex;
use sysinfo::{CpuExt, System, SystemExt};
use tauri::{Manager, State};

pub struct AppState {
    pub system: Mutex<System>,
}

#[derive(Serialize, Clone)]
pub struct HardwareSpecs {
    pub os_name: String,
    pub cpu_name: String,
    pub cpu_cores_physical: u32,
    pub cpu_cores_logical: u32,
    pub ram_total_gb: f64,
    pub gpu_name: String,
    pub tier: String,
}

#[derive(Serialize, Clone)]
pub struct Telemetry {
    pub cpu_usage: f64,
    pub ram_used_gb: f64,
    pub ram_total_gb: f64,
    pub gpu_name: String,
    pub vram_used_gb: f64,
    pub vram_total_gb: f64,
}

#[tauri::command]
pub fn get_hardware_specs(state: State<AppState>) -> HardwareSpecs {
    let mut system = state.system.lock().unwrap();
    system.refresh_cpu();
    system.refresh_memory();

    let cpu = system.global_cpu_info();
    let cpu_name = cpu.brand().to_string();
    let cpu_cores_physical = system.physical_core_count().unwrap_or(4) as u32;
    let cpu_cores_logical = system.cpus().len() as u32;
    let ram_total_gb = (system.total_memory() as f64) / (1024.0 * 1024.0 * 1024.0);

    let os_name = if cfg!(target_os = "windows") {
        "Windows"
    } else if cfg!(target_os = "macos") {
        "macOS"
    } else {
        "Linux"
    }
    .to_string();

    let tier = if ram_total_gb >= 32.0 {
        "high"
    } else if ram_total_gb >= 16.0 {
        "mid"
    } else {
        "low"
    }
    .to_string();

    HardwareSpecs {
        os_name,
        cpu_name,
        cpu_cores_physical,
        cpu_cores_logical,
        ram_total_gb: (ram_total_gb * 100.0).round() / 100.0,
        gpu_name: detect_gpu(),
        tier,
    }
}

#[tauri::command]
pub fn get_telemetry(state: State<AppState>) -> Telemetry {
    let mut system = state.system.lock().unwrap();
    system.refresh_cpu();
    system.refresh_memory();

    let cpu_usage = system.global_cpu_info().cpu_usage() as f64;
    let ram_used_gb = (system.used_memory() as f64) / (1024.0 * 1024.0 * 1024.0);
    let ram_total_gb = (system.total_memory() as f64) / (1024.0 * 1024.0 * 1024.0);

    Telemetry {
        cpu_usage: (cpu_usage * 10.0).round() / 10.0,
        ram_used_gb: (ram_used_gb * 100.0).round() / 100.0,
        ram_total_gb: (ram_total_gb * 100.0).round() / 100.0,
        gpu_name: detect_gpu(),
        vram_used_gb: 0.0,
        vram_total_gb: 0.0,
    }
}

#[tauri::command]
pub async fn start_server(params: serde_json::Value) -> Result<String, String> {
    let model_path = params.get("model_path").and_then(|v| v.as_str()).unwrap_or("");
    let port = params.get("port").and_then(|v| v.as_u64()).unwrap_or(8080);
    let backend_type = params.get("backend_type").and_then(|v| v.as_str()).unwrap_or("auto");
    let threads = params.get("threads").and_then(|v| v.as_u64()).unwrap_or(8);
    let use_gpu = params.get("use_gpu").and_then(|v| v.as_bool()).unwrap_or(true);

    let app_dir = std::env::current_dir().map_err(|e| e.to_string())?;
    let serve_script = app_dir.join("scripts").join("server").join("serve.cjs");
    let node_exe = app_dir.join("app").join("tools").join("node-win").join("node.exe");

    let node = if node_exe.exists() { node_exe } else { std::process::Command::new("node").program().into() };

    let mut cmd = std::process::Command::new(&node);
    cmd.arg(&serve_script)
        .env("FRONTEND_PORT", port.to_string())
        .env("BACKEND_TYPE", backend_type)
        .env("THREADS", threads.to_string())
        .env("USE_GPU", if use_gpu { "1" } else { "0" });

    if !model_path.is_empty() {
        cmd.env("MODEL_PATH", model_path);
    }

    cmd.spawn().map_err(|e| format!("Failed to start backend: {}", e))?;

    Ok("Server started".to_string())
}

#[tauri::command]
pub async fn stop_server() -> Result<String, String> {
    if cfg!(target_os = "windows") {
        std::process::Command::new("taskkill")
            .args(["/f", "/im", "node.exe"])
            .spawn()
            .map_err(|e| e.to_string())?;
        std::process::Command::new("taskkill")
            .args(["/f", "/im", "sd-server.exe"])
            .spawn()
            .ok();
    } else {
        std::process::Command::new("pkill")
            .args(["-f", "serve.cjs"])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok("Server stopped".to_string())
}

#[tauri::command]
pub async fn set_auto_start(app_handle: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let autostart = app_handle.plugin::<tauri_plugin_autostart::Autostart>();
    if enabled {
        autostart.enable().map_err(|e| e.to_string())?;
    } else {
        autostart.disable().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn is_auto_start_enabled(app_handle: tauri::AppHandle) -> Result<bool, String> {
    let autostart = app_handle.plugin::<tauri_plugin_autostart::Autostart>();
    autostart.is_enabled().map_err(|e| e.to_string())
}

fn detect_gpu() -> String {
    if cfg!(target_os = "windows") {
        let output = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_VideoController | Select-Object -First 1 -ExpandProperty Name",
            ])
            .output();
        if let Ok(out) = output {
            let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !name.is_empty() {
                return name;
            }
        }
    }
    "Detecting...".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let system = System::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .manage(AppState {
            system: Mutex::new(system),
        })
        .setup(|app| {
            // Build tray menu
            use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
            use tauri::tray::TrayIconBuilder;

            let show_i = MenuItemBuilder::with_id("show", "Show Window").build(app)?;
            let hide_i = MenuItemBuilder::with_id("hide", "Hide Window").build(app)?;
            let separator = tauri::menu::PredefinedMenuItem::separator(app)?;
            let quit_i = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&show_i)
                .item(&hide_i)
                .item(&separator)
                .item(&quit_i)
                .build()?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Uncensored AI Studio")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "hide" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_hardware_specs,
            get_telemetry,
            start_server,
            stop_server,
            set_auto_start,
            is_auto_start_enabled,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
