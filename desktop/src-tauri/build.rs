fn main() {
  // Force Cargo to recompile main.rs when these env vars change.
  // Without this, option_env!() values get stale in cached builds.
  println!("cargo:rerun-if-env-changed=MAIL_OAUTH_GMAIL_CLIENT_ID");
  println!("cargo:rerun-if-env-changed=MAIL_OAUTH_OUTLOOK_CLIENT_ID");

  tauri_build::build()
}
