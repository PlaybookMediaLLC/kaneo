//! Updates. They are on only in builds that set `plugins.updater` (a public key and an
//! endpoint); the release workflow sets it. Local and development builds have no updater.

use tauri::AppHandle;
use tauri_plugin_dialog::{
    DialogExt, MessageDialogBuilder, MessageDialogButtons, MessageDialogKind,
};
use tauri_plugin_updater::UpdaterExt;

use crate::text::{t, with};

pub fn enabled(app: &AppHandle) -> bool {
    app.config().plugins.0.contains_key("updater")
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    if enabled(app) {
        app.plugin(tauri_plugin_updater::Builder::new().build())?;
        // Defer the background update check off cold start so it does not compete with initial app load.
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = tauri::async_runtime::spawn_blocking(|| {
                std::thread::sleep(std::time::Duration::from_secs(5));
            })
            .await;
            check(handle, false);
        });
    }
    Ok(())
}

/// Shows a dialog without holding an async worker while it is open.
async fn ask(dialog: MessageDialogBuilder<tauri::Wry>) -> bool {
    tauri::async_runtime::spawn_blocking(move || dialog.blocking_show())
        .await
        .unwrap_or(false)
}

/// Checks for an update and offers to install it. `manual` also reports "up to date" and errors.
pub fn check(app: AppHandle, manual: bool) {
    tauri::async_runtime::spawn(async move {
        let found = match app.updater() {
            Ok(updater) => updater.check().await,
            Err(error) => Err(error),
        };
        let dialog = app.dialog();
        match found {
            Ok(Some(update)) => {
                let install = ask(dialog
                    .message(with(
                        "update.message",
                        "version",
                        &update.version.to_string(),
                    ))
                    .title(t("update.title"))
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        t("update.install"),
                        t("update.later"),
                    )))
                .await;
                if !install {
                    return;
                }
                match update.download_and_install(|_, _| {}, || {}).await {
                    Ok(()) => app.restart(),
                    Err(error) => {
                        ask(dialog
                            .message(with("update.failed", "error", &error.to_string()))
                            .kind(MessageDialogKind::Error))
                        .await;
                    }
                }
            }
            Ok(None) if manual => {
                ask(dialog
                    .message(t("update.none"))
                    .title(t("update.noneTitle")))
                .await;
            }
            Err(error) if manual => {
                ask(dialog
                    .message(with("update.checkFailed", "error", &error.to_string()))
                    .kind(MessageDialogKind::Error))
                .await;
            }
            _ => {}
        }
    });
}
