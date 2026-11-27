//! The server that the main window shows: what the person picks, how the app remembers it,
//! and what the server's pages may ask of the app.

use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::Mutex,
};

use serde::Serialize;
use tauri::{ipc::CapabilityBuilder, AppHandle, Manager, State, Url};
use url::Host;

use crate::{text, window};

/// The current server, and the origins that already have their IPC capability.
#[derive(Default)]
pub struct Server {
    current: Mutex<Option<Url>>,
    allowed: Mutex<HashSet<String>>,
}

impl Server {
    pub fn current(&self) -> Option<Url> {
        self.current.lock().unwrap().clone()
    }
}

/// Turns what a person types into a server origin. Without a scheme, a local or private host
/// gets `http://` and any other host `https://`. Paths, queries and fragments are dropped.
pub fn parse(input: &str) -> Result<Url, String> {
    let text = input.trim();
    if text.is_empty() {
        return Err(text::t("error.empty"));
    }
    let explicit = text.contains("://");
    let mut url = Url::parse(&if explicit {
        text.to_string()
    } else {
        format!("http://{text}")
    })
    .map_err(|_| text::t("error.invalid"))?;
    if !matches!(url.scheme(), "http" | "https") || url.host().is_none() {
        return Err(text::t("error.scheme"));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(text::t("error.credentials"));
    }
    match url.host() {
        Some(Host::Ipv4(_)) => {}
        Some(Host::Domain(name))
            if name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')) => {}
        // Tauri's URL patterns cannot hold an IPv6 address or other host characters, and a
        // capability with a bad pattern stops the app.
        _ => return Err(text::t("error.invalid")),
    }
    if !explicit && !is_local(&url) {
        url.set_scheme("https")
            .expect("http and https are both special schemes");
    }
    Url::parse(&url.origin().ascii_serialization()).map_err(|error| error.to_string())
}

/// Hosts on this machine or on a private network: localhost, `.local` names and loopback,
/// private or link-local addresses.
fn is_local(url: &Url) -> bool {
    match url.host() {
        Some(Host::Domain(name)) => {
            name == "localhost" || name.ends_with(".localhost") || name.ends_with(".local")
        }
        Some(Host::Ipv4(ip)) => ip.is_loopback() || ip.is_private() || ip.is_link_local(),
        _ => false,
    }
}

fn settings_file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("server"))
}

fn saved(app: &AppHandle) -> Option<Url> {
    parse(&std::fs::read_to_string(settings_file(app)?).ok()?).ok()
}

fn save(app: &AppHandle, url: &Url) -> Result<(), String> {
    let file = settings_file(app).ok_or_else(|| text::t("error.settings"))?;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    }
    std::fs::write(file, url.as_str()).map_err(|error| error.to_string())
}

/// Picks the first server: `QUILLS_DESKTOP_SERVER_URL` (`pnpm dev:desktop` sets it), then the
/// saved one. The picker page connects to it, or asks for one when there is none.
pub fn start(app: &AppHandle) -> tauri::Result<()> {
    app.manage(Server::default());
    let from_env = std::env::var("QUILLS_DESKTOP_SERVER_URL")
        .ok()
        .and_then(|text| parse(&text).ok());
    if let Some(url) = from_env.or_else(|| saved(app)) {
        use_server(app, &url)?;
    }
    Ok(())
}

/// Makes `url` the current server and lets its pages use the few app features they need: the
/// Dock badge, native notifications and zoom. Nothing else: an XSS on a server page must not
/// reach the file system or the server picker.
fn use_server(app: &AppHandle, url: &Url) -> tauri::Result<()> {
    let state = app.state::<Server>();
    *state.current.lock().unwrap() = Some(url.clone());
    let origin = url.origin().ascii_serialization();
    if !state.allowed.lock().unwrap().insert(origin.clone()) {
        return Ok(());
    }
    let id: String = origin
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    app.add_capability(
        CapabilityBuilder::new(format!("server-{id}"))
            .remote(format!("{origin}/*"))
            .window(window::LABEL)
            .permission("core:window:allow-set-badge-count")
            .permission("core:webview:allow-set-webview-zoom")
            .permission("notification:allow-is-permission-granted")
            .permission("notification:allow-request-permission")
            .permission("notification:allow-notify"),
    )
}

/// The new server origin when a main-frame page load shows that the server moved: `http://` to
/// `https://` on the same host, or to or from `www.` of the same host. Other hosts are pages of
/// other sites, and a move back to `http://` is never followed.
pub fn moved(current: &Url, loaded: &Url) -> Option<Url> {
    if !matches!(loaded.scheme(), "http" | "https") {
        return None;
    }
    let (old, new) = (current.host_str()?, loaded.host_str()?);
    let upgrade = current.scheme() == "http" && loaded.scheme() == "https";
    let same_scheme = current.scheme() == loaded.scheme();
    let www = new.strip_prefix("www.") == Some(old) || old.strip_prefix("www.") == Some(new);
    let same_port = current.port_or_known_default() == loaded.port_or_known_default();
    let follow = (old == new && upgrade) || (www && (upgrade || (same_scheme && same_port)));
    follow
        .then(|| parse(&loaded.origin().ascii_serialization()).ok())
        .flatten()
}

/// Saves the new origin of a server that moved, so its pages keep the capability and later starts
/// use it. Page loads are main-frame only, so an iframe never moves the server.
pub fn follow_move(app: &AppHandle, loaded: &Url) {
    let Some(current) = app.state::<Server>().current() else {
        return;
    };
    if let Some(new) = moved(&current, loaded) {
        let _ = save(app, &new);
        let _ = use_server(app, &new);
    }
}

#[derive(Serialize)]
pub struct PickerState {
    cloud: Option<String>,
    current: Option<String>,
    lang: &'static str,
    /// The picker's text in the system language.
    text: HashMap<String, String>,
}

#[tauri::command]
pub fn picker_state(state: State<'_, Server>) -> PickerState {
    PickerState {
        cloud: parse(env!("QUILLS_DESKTOP_CLOUD_URL"))
            .ok()
            .map(|url| url.to_string()),
        current: state.current().map(|url| url.to_string()),
        lang: text::locale(),
        text: text::all()
            .iter()
            .filter(|(key, _)| key.starts_with("picker."))
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect(),
    }
}

#[tauri::command]
pub fn normalize(address: String) -> Result<String, String> {
    parse(&address).map(|url| url.to_string())
}

#[tauri::command]
pub fn connect(app: AppHandle, address: String) -> Result<(), String> {
    let url = parse(&address)?;
    let unchanged = app.state::<Server>().current().as_ref() == Some(&url);
    use_server(&app, &url).map_err(|error| error.to_string())?;
    if !unchanged || !settings_file(&app).is_some_and(|path| path.exists()) {
        save(&app, &url)?;
    }
    window::show(&app, url);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_https_to_a_public_host() {
        assert_eq!(
            parse("quills.example.com").unwrap().as_str(),
            "https://quills.example.com/"
        );
        assert_eq!(
            parse("Quills.Example.com:8443").unwrap().as_str(),
            "https://quills.example.com:8443/"
        );
    }

    #[test]
    fn adds_http_to_a_local_or_private_host() {
        for (input, expected) in [
            ("localhost:5190", "http://localhost:5190/"),
            ("127.0.0.1:5190", "http://127.0.0.1:5190/"),
            ("192.168.1.20:1337", "http://192.168.1.20:1337/"),
            ("nas.local", "http://nas.local/"),
        ] {
            assert_eq!(parse(input).unwrap().as_str(), expected, "{input}");
        }
    }

    #[test]
    fn keeps_an_explicit_scheme_and_drops_the_path() {
        assert_eq!(
            parse(" http://quills.example.com:8080/dashboard?x=1#y ")
                .unwrap()
                .as_str(),
            "http://quills.example.com:8080/"
        );
    }

    #[test]
    fn follows_https_and_www_moves_only() {
        let url = |text: &str| Url::parse(text).unwrap();
        let moved_to = |from: &str, to: &str| moved(&url(from), &url(to)).map(|u| u.to_string());
        assert_eq!(
            moved_to("http://nas.local/", "https://nas.local/board"),
            Some("https://nas.local/".into())
        );
        assert_eq!(
            moved_to("https://example.com/", "https://www.example.com/x"),
            Some("https://www.example.com/".into())
        );
        assert_eq!(
            moved_to("https://www.example.com/", "https://example.com/"),
            Some("https://example.com/".into())
        );
        assert_eq!(
            moved_to("http://example.com/", "https://www.example.com/"),
            Some("https://www.example.com/".into())
        );
        assert_eq!(
            moved_to("https://example.com/", "http://example.com/"),
            None
        );
        assert_eq!(
            moved_to("https://example.com/", "https://www.example.com:8443/"),
            None
        );
        assert_eq!(
            moved_to("https://example.com/", "https://github.com/login"),
            None
        );
        assert_eq!(
            moved_to("https://example.com/", "https://example.com/dashboard"),
            None
        );
        assert_eq!(
            moved_to("https://example.com/", "https://api.example.com/"),
            None
        );
    }

    #[test]
    fn refuses_other_schemes_credentials_and_empty_input() {
        assert!(parse("").is_err());
        assert!(parse("file:///etc/passwd").is_err());
        assert!(parse("javascript:alert(1)").is_err());
        // A user name or a password alone is enough to refuse the address.
        assert!(parse("https://user@quills.example.com").is_err());
        // Split, so that secret scanners do not read the test address as a leaked password.
        assert!(parse(concat!("https://:", "secret@quills.example.com")).is_err());
        assert!(parse("user:secret@quills.example.com").is_err());
        assert!(parse("[::1]:8080").is_err());
        assert!(parse("http://[fe80::1]").is_err());
        assert!(parse("https://a+b.example").is_err());
    }
}
