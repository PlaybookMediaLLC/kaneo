import { EventEmitter } from "node:events";

// Stagehand controls the UI; CDP supplies network interception and diagnostics.
export async function connectCDP(url) {
  let endpoint = url;
  if (url.startsWith("http")) {
    const response = await fetch(new URL("/json/version", url));
    if (!response.ok)
      throw new Error(`Chrome discovery failed: ${response.status}`);
    endpoint = (await response.json()).webSocketDebuggerUrl;
  }
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error("Chrome connection failed")),
      { once: true },
    );
  });
  let sequence = 0;
  const pending = new Map();
  const events = new EventEmitter();
  const fail = () => {
    for (const task of pending.values())
      task.reject(new Error("Browser connection closed"));
    pending.clear();
  };
  socket.addEventListener("close", fail);
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(String(data));
    if (message.id) {
      const task = pending.get(message.id);
      if (!task) return;
      pending.delete(message.id);
      if (message.error) task.reject(new Error(message.error.message));
      else task.resolve(message.result);
    } else events.emit(message.method, message.params, message.sessionId);
  });
  return {
    events,
    send(method, params = {}, sessionId = undefined) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP timed out: ${method}`));
        }, 20_000);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },
    close() {
      fail();
      socket.close();
      events.removeAllListeners();
    },
  };
}

export async function attachPage(cdp, page) {
  const marker = `about:blank#stagehand-${crypto.randomUUID()}`;
  await page.goto(marker);
  const { targetInfos } = await cdp.send("Target.getTargets");
  const target = targetInfos.find(
    (item) => item.type === "page" && item.url === marker,
  );
  if (!target) throw new Error("Stagehand page target not found");
  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: true,
  });
  const listeners = [];
  return {
    send: (method, params) => cdp.send(method, params, sessionId),
    on(method, listener) {
      const scoped = (params, id) => {
        if (id === sessionId) listener(params);
      };
      cdp.events.on(method, scoped);
      listeners.push([method, scoped]);
    },
    dispose() {
      for (const [method, listener] of listeners)
        cdp.events.off(method, listener);
    },
  };
}
