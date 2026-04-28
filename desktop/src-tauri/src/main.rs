use std::env;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{PathBuf, Path};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

const BUILD_MAIL_OAUTH_GMAIL_CLIENT_ID: Option<&str> = option_env!("MAIL_OAUTH_GMAIL_CLIENT_ID");
const BUILD_MAIL_OAUTH_OUTLOOK_CLIENT_ID: Option<&str> = option_env!("MAIL_OAUTH_OUTLOOK_CLIENT_ID");

#[derive(Clone)]
struct SidecarState(Arc<Mutex<Option<Child>>>);

fn main() {
  let sidecar_state = SidecarState(Arc::new(Mutex::new(None)));

  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .setup({
      let sidecar_state = sidecar_state.clone();
      move |app| {
        let sidecar_path = resolve_sidecar(app)?;
        let mut log_file = init_sidecar_log(app).ok();
        append_log_line(log_file.as_mut(), &format!("resolved sidecar: {}", sidecar_path.display()));

        let mut cmd = Command::new(&sidecar_path);
        cmd
          .env("GUI_BACKEND_HOST", "127.0.0.1")
          .env("GUI_BACKEND_PORT", "8787");
        set_env_if_non_empty(
          &mut cmd,
          "MAIL_OAUTH_GMAIL_CLIENT_ID",
          BUILD_MAIL_OAUTH_GMAIL_CLIENT_ID,
        );
        set_env_if_non_empty(
          &mut cmd,
          "MAIL_OAUTH_OUTLOOK_CLIENT_ID",
          BUILD_MAIL_OAUTH_OUTLOOK_CLIENT_ID,
        );

        if let Some(log) = &log_file {
          if let Ok(stdout_log) = log.try_clone() {
            cmd.stdout(Stdio::from(stdout_log));
          }
          if let Ok(stderr_log) = log.try_clone() {
            cmd.stderr(Stdio::from(stderr_log));
          }
        }

        let child = cmd
          .spawn()
          .map_err(|e| tauri::Error::AssetNotFound(format!(
            "failed to spawn sidecar at {}: {e}",
            sidecar_path.display(),
          )))?;
        append_log_line(log_file.as_mut(), &format!("spawned sidecar pid={}", child.id()));

        let mut guard = sidecar_state.0.lock().expect("sidecar lock");
        *guard = Some(child);
        Ok(())
      }
    })
    .on_window_event({
      let sidecar_state = sidecar_state.clone();
      move |event| {
        if let tauri::WindowEvent::CloseRequested { .. } = event.event() {
          if let Ok(mut guard) = sidecar_state.0.lock() {
            if let Some(mut child) = guard.take() {
              let _ = child.kill();
            }
          }
        }
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

fn set_env_if_non_empty(cmd: &mut Command, key: &str, value: Option<&str>) {
  if let Some(value) = value {
    if !value.trim().is_empty() {
      cmd.env(key, value);
    }
  }
}

fn init_sidecar_log(app: &tauri::App) -> std::io::Result<std::fs::File> {
  let log_dir = app
    .path_resolver()
    .app_log_dir()
    .or_else(|| app.path_resolver().app_data_dir())
    .unwrap_or_else(std::env::temp_dir);
  fs::create_dir_all(&log_dir)?;
  let log_path = log_dir.join("sidecar.log");
  OpenOptions::new().create(true).append(true).open(log_path)
}

fn append_log_line(log_file: Option<&mut std::fs::File>, line: &str) {
  if let Some(file) = log_file {
    let _ = writeln!(file, "{line}");
  }
}

fn resolve_sidecar(app: &tauri::App) -> Result<PathBuf, tauri::Error> {
  let target_sidecar = if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
    Some("bin/ebp-gui-backend-x86_64-unknown-linux-gnu")
  } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
    Some("bin/ebp-gui-backend-aarch64-unknown-linux-gnu")
  } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
    Some("bin/ebp-gui-backend-x86_64-apple-darwin")
  } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
    Some("bin/ebp-gui-backend-aarch64-apple-darwin")
  } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
    Some("bin/ebp-gui-backend-x86_64-pc-windows-msvc")
  } else {
    None
  };

  let mut candidates = vec![
    "bin/ebp-gui-backend",
    "ebp-gui-backend",
  ];
  if let Some(target_sidecar) = target_sidecar {
    candidates.insert(0, target_sidecar);
    if let Some(file_name) = Path::new(target_sidecar).file_name().and_then(|s| s.to_str()) {
      candidates.insert(1, file_name);
    }
  }

  let mut expanded_candidates: Vec<String> = Vec::new();
  for candidate in &candidates {
    expanded_candidates.push((*candidate).to_string());
    if cfg!(target_os = "windows") {
      expanded_candidates.push(format!("{candidate}.exe"));
    }
  }

  let mut attempted_paths: Vec<PathBuf> = Vec::new();
  let mut try_path = |path: PathBuf| {
    attempted_paths.push(path.clone());
    if path.exists() {
      return Some(path);
    }
    None
  };

  for candidate in &expanded_candidates {
    if let Some(path) = app.path_resolver().resolve_resource(candidate) {
      if let Some(found) = try_path(path) {
        return Ok(found);
      }
    }
  }

  if let Some(resource_dir) = app.path_resolver().resource_dir() {
    for candidate in &expanded_candidates {
      if let Some(found) = try_path(resource_dir.join(candidate)) {
        return Ok(found);
      }
      let file_name = Path::new(candidate).file_name().unwrap();
      if let Some(found) = try_path(resource_dir.join(file_name)) {
        return Ok(found);
      }
    }
  }

  if let Ok(appdir) = env::var("APPDIR") {
    let appdir_path = Path::new(&appdir);
    for candidate in &expanded_candidates {
      let path = appdir_path.join("usr/bin").join(Path::new(candidate).file_name().unwrap());
      if let Some(found) = try_path(path) {
        return Ok(found);
      }
    }
  }

  if let Ok(exe_path) = env::current_exe() {
    if let Some(exe_dir) = exe_path.parent() {
      for candidate in &expanded_candidates {
        if let Some(found) = try_path(exe_dir.join(candidate)) {
          return Ok(found);
        }
        let file_name = Path::new(candidate).file_name().unwrap();
        if let Some(found) = try_path(exe_dir.join(file_name)) {
          return Ok(found);
        }
      }
    }

    // macOS app bundles commonly place Resources and MacOS side-by-side under Contents.
    if let Some(contents_dir) = exe_path.parent().and_then(|p| p.parent()) {
      let resources_dir = contents_dir.join("Resources");
      for candidate in &expanded_candidates {
        if let Some(found) = try_path(resources_dir.join(candidate)) {
          return Ok(found);
        }
        let file_name = Path::new(candidate).file_name().unwrap();
        if let Some(found) = try_path(resources_dir.join(file_name)) {
          return Ok(found);
        }
      }
    }

    if let Some(appdir_path) = exe_path.parent().and_then(|p| p.parent()) {
      for candidate in &expanded_candidates {
        let path = appdir_path.join("usr/bin").join(Path::new(candidate).file_name().unwrap());
        if let Some(found) = try_path(path) {
          return Ok(found);
        }
      }
    }
  }

  Err(tauri::Error::AssetNotFound(
    format!(
      "sidecar binary not found in resources; attempted: {}",
      attempted_paths
        .iter()
        .map(|p| p.display().to_string())
        .collect::<Vec<_>>()
        .join(", ")
    ),
  ))
}
