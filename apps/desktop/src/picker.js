// The first screen of the desktop app. It connects to the saved server, or asks for one. The
// "Change Server…" menu item opens it with ?change=true, which shows the form at once.
const invoke = (command, args) =>
  window.__TAURI_INTERNALS__.invoke(command, args);

const element = (id) => document.getElementById(id);
const status = element("status");
const input = element("address");
const buttons = [...document.querySelectorAll("button")];
/** The picker's text in the system language; the HTML holds the English. */
let text = {};
const say = (key, host) => (text[key] ?? key).replace("{host}", host ?? "");

function busy(on, message = "") {
  for (const button of buttons) button.disabled = on;
  status.textContent = message;
}

function choose() {
  element("saved").hidden = true;
  element("choose").hidden = false;
  input.focus();
}

/** True when the server answers. An opaque response is enough to prove it. */
async function answers(url, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(new URL("/api/health", url), {
      mode: "no-cors",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function connect(
  address,
  { normalized = false, timeoutMs = 10_000 } = {},
) {
  busy(true, say("picker.connecting"));
  try {
    const url = normalized ? address : await invoke("normalize", { address });
    if (!(await answers(url, timeoutMs))) {
      busy(false, say("picker.cannotReach", new URL(url).host));
      return false;
    }
    await invoke("connect", { address: url });
    return true;
  } catch (error) {
    busy(false, String(error));
    return false;
  }
}

async function main() {
  const state = await invoke("picker_state");
  text = state.text;
  document.documentElement.lang = state.lang;
  for (const node of document.querySelectorAll("[data-text]"))
    if (text[node.dataset.text]) node.textContent = text[node.dataset.text];
  document.title = say("picker.title");
  if (state.cloud) {
    element("cloud-choice").hidden = false;
    element("cloud-host").textContent = new URL(state.cloud).host;
    element("cloud").addEventListener("click", () => void connect(state.cloud));
  }
  element("form").addEventListener("submit", (event) => {
    event.preventDefault();
    void connect(input.value);
  });
  element("change").addEventListener("click", choose);
  element("retry").addEventListener("click", () => void connect(state.current));
  if (state.current) input.value = state.current;
  if (!state.current || new URLSearchParams(location.search).has("change")) {
    choose();
    return;
  }
  element("saved").hidden = false;
  element("saved-text").textContent = say(
    "picker.connectingTo",
    new URL(state.current).host,
  );
  if (!(await connect(state.current, { normalized: true, timeoutMs: 3_000 })))
    element("saved-text").textContent = say(
      "picker.noAnswer",
      new URL(state.current).host,
    );
}

void main();
