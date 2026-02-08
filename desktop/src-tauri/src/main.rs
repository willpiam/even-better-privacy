use std::sync::{Arc, Mutex};
use tauri::api::process::{Command, CommandChild};

#[derive(Clone)]
struct SidecarState(Arc<Mutex<Option<CommandChild>>>);

fn main() {
  let sidecar_state = SidecarState(Arc::new(Mutex::new(None)));

  tauri::Builder::default()
    .setup({
      let sidecar_state = sidecar_state.clone();
      move |_app| {
        let (mut child, _rx) = Command::new_sidecar("ebp-gui-backend")?
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
