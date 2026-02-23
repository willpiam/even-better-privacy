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

        let child = Command::new(sidecar_path)
          .env("GUI_BACKEND_HOST", "127.0.0.1")
          .env("GUI_BACKEND_PORT", "8787")
          .spawn()?;

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

  let mut candidates = vec!["bin/ebp-gui-backend"];
  if let Some(target_sidecar) = target_sidecar {
    candidates.insert(0, target_sidecar);
  }

  let mut expanded_candidates: Vec<String> = Vec::new();
  for candidate in &candidates {
    expanded_candidates.push((*candidate).to_string());
    if cfg!(target_os = "windows") {
      expanded_candidates.push(format!("{candidate}.exe"));
    }
  }

  for candidate in &expanded_candidates {
    if let Some(path) = app.path_resolver().resolve_resource(candidate) {
      if path.exists() {
        return Ok(path);
      }
    }
  }

  if let Some(resource_dir) = app.path_resolver().resource_dir() {
    for candidate in &expanded_candidates {
      let path = resource_dir.join(candidate);
      if path.exists() {
        return Ok(path);
      }
    }
  }

  if let Ok(appdir) = env::var("APPDIR") {
    let appdir_path = Path::new(&appdir);
    for candidate in &expanded_candidates {
      let path = appdir_path.join("usr/bin").join(Path::new(candidate).file_name().unwrap());
      if path.exists() {
        return Ok(path);
      }
    }
  }

  if let Ok(exe_path) = env::current_exe() {
    if let Some(exe_dir) = exe_path.parent() {
      for candidate in &expanded_candidates {
        let file_name = Path::new(candidate).file_name().unwrap();
        let path = exe_dir.join(file_name);
        if path.exists() {
          return Ok(path);
        }
      }
    }

    if let Some(appdir_path) = exe_path.parent().and_then(|p| p.parent()) {
      for candidate in &expanded_candidates {
        let path = appdir_path.join("usr/bin").join(Path::new(candidate).file_name().unwrap());
        if path.exists() {
          return Ok(path);
        }
      }
    }
  }

  Err(tauri::Error::AssetNotFound(
    "sidecar binary not found in resources".into(),
  ))
}
