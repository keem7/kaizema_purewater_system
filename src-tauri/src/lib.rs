use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let icon_bytes = include_bytes!("../icons/icon.png");
      let img = image::load_from_memory(icon_bytes)
        .expect("failed to load icon")
        .to_rgba8();
      let (width, height) = img.dimensions();
      let icon = tauri::image::Image::new_owned(img.into_raw(), width, height);
      if let Some(window) = app.get_webview_window("main") {
        window.set_icon(icon)?;
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
