use std::env;
use std::path::{PathBuf, Path};
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};

#[derive(Clone)]
struct SidecarState(Arc<Mutex<Option<Child>>>);

fn main() {
  let sidecar_state = SidecarState(Arc::new(Mutex::new(None)));

  tauri::Builder::default()
    .setup({
      let sidecar_state = sidecar_state.clone();
      move |app| {
        let sidecar_path = resolve_sidecar(app)?;

        let child = Command::new(&sidecar_path)
          .env("GUI_BACKEND_HOST", "127.0.0.1")
          .env("GUI_BACKEND_PORT", "8787")
          .spawn()
          .map_err(|e| tauri::Error::AssetNotFound(format!(
            "failed to spawn sidecar at {}: {e}",
            sidecar_path.display(),
          )))?;

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
