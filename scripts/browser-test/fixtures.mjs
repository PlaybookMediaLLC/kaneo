export async function intercept(browser, page, handler, diagnostics) {
  const { session } = browser.monitor(page);
  session.on("Fetch.requestPaused", (event) => {
    void (async () => {
      if (event.responseStatusCode >= 300 && event.responseStatusCode < 400)
        return session.send("Fetch.continueRequest", {
          requestId: event.requestId,
        });
      if (event.responseStatusCode) {
        // Screenshot fixtures permit one page only; CSP also covers nested frames.
        const response = await session.send("Fetch.getResponseBody", {
          requestId: event.requestId,
        });
        return session.send("Fetch.fulfillRequest", {
          requestId: event.requestId,
          responseCode: event.responseStatusCode,
          body: response.base64Encoded
            ? response.body
            : Buffer.from(response.body).toString("base64"),
          responseHeaders: [
            ...(event.responseHeaders ?? []).filter(
              ({ name }) =>
                !["content-encoding", "content-length"].includes(
                  name.toLowerCase(),
                ),
            ),
            {
              name: "Content-Security-Policy",
              value:
                "worker-src 'none'; sandbox allow-scripts allow-same-origin allow-forms allow-modals allow-downloads",
            },
          ],
        });
      }
      const result = await handler(event.request);
      if (result === undefined)
        return session.send("Fetch.continueRequest", {
          requestId: event.requestId,
        });
      if (result === null)
        return session.send("Fetch.failRequest", {
          requestId: event.requestId,
          errorReason: "BlockedByClient",
        });
      const { status = 200, headers = {}, body = "" } = result;
      await session.send("Fetch.fulfillRequest", {
        requestId: event.requestId,
        responseCode: status,
        responseHeaders: Object.entries(headers).map(([name, value]) => ({
          name,
          value,
        })),
        body: Buffer.from(body).toString("base64"),
      });
    })().catch(async (error) => {
      // Chrome removes paused requests when the page cancels them or navigates.
      if (error.message === "Invalid InterceptionId.") return;
      (diagnostics.errors ??= []).push(
        `Fixture interception: ${error.message}`,
      );
      await session
        .send("Fetch.failRequest", {
          requestId: event.requestId,
          errorReason: "Failed",
        })
        .catch(() => {});
    });
  });
  await session.send("Fetch.enable", {
    patterns: [
      { urlPattern: "*", requestStage: "Request" },
      { urlPattern: "*", resourceType: "Document", requestStage: "Response" },
    ],
  });
}
