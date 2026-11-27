import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { Viewer } from "../core/types";
import { getUserWsUrl } from "../ui/upstream";

const BASE_DELAY = 1_000;
const MAX_RETRY_DELAY = 30_000;
const WS_PING_INTERVAL_MS = 30_000;
const SUPPORT_REFETCH_MS = 150;

/**
 * Connects signed-in portal customers to `/api/ws/user` and consumes `QUILLS_CUSTOMER_CHANGED`
 * events so support conversations and tickets update in real time without 10s polling.
 */
export function usePortalRealtime(
  workspaceId: string,
  viewer: Viewer,
  enabled: boolean,
) {
  const queryClient = useQueryClient();
  const userId = viewer.kind === "user" ? viewer.id : null;

  useEffect(() => {
    if (!enabled || !workspaceId || !userId || typeof WebSocket === "undefined")
      return;

    let disposed = false;
    let activeSocket: WebSocket | null = null;
    let retryDelay = BASE_DELAY;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let pingInterval: ReturnType<typeof setInterval> | null = null;
    let refetchTimer: ReturnType<typeof setTimeout> | null = null;
    let hasConnected = false;

    const clearPing = () => {
      if (pingInterval !== null) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
    };

    const scheduleSupportRefresh = () => {
      if (refetchTimer !== null) return;
      refetchTimer = setTimeout(() => {
        refetchTimer = null;
        if (disposed) return;
        // Portal URLs may hold a slug while events carry the canonical workspace ID,
        // so invalidate this portal's support area for the authenticated customer.
        void queryClient.invalidateQueries({
          queryKey: ["quills", workspaceId, userId, "support"],
        });
      }, SUPPORT_REFETCH_MS);
    };

    const connect = () => {
      if (disposed) return;
      retryTimeout = null;
      const ws = new WebSocket(getUserWsUrl());
      activeSocket = ws;

      ws.onopen = () => {
        if (disposed || activeSocket !== ws) return;
        retryDelay = BASE_DELAY;
        if (hasConnected) scheduleSupportRefresh();
        hasConnected = true;
        clearPing();
        pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, WS_PING_INTERVAL_MS);
      };

      ws.onmessage = (event) => {
        if (disposed || activeSocket !== ws) return;
        try {
          const message = JSON.parse(event.data as string) as {
            type?: string;
            workspaceId?: string;
          };
          if (message.type === "USER_ACCESS_REVOKED") {
            disposed = true;
            clearPing();
            if (refetchTimer !== null) {
              clearTimeout(refetchTimer);
              refetchTimer = null;
            }
            activeSocket = null;
            ws.close();
            queryClient.removeQueries({
              queryKey: ["quills", workspaceId, userId],
            });
            return;
          }
          if (message.type === "QUILLS_CUSTOMER_CHANGED") {
            scheduleSupportRefresh();
          }
        } catch {
          // Ignore malformed frames
        }
      };

      ws.onclose = (event) => {
        if (disposed || activeSocket !== ws) return;
        clearPing();
        activeSocket = null;
        // Stop reconnecting and evict cached private customer data if auth ended or was revoked.
        if (event?.code === 1008 || event?.code === 4001) {
          queryClient.removeQueries({
            queryKey: ["quills", workspaceId, userId],
          });
          return;
        }
        const delay = retryDelay;
        retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
        retryTimeout = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      disposed = true;
      clearPing();
      if (retryTimeout !== null) clearTimeout(retryTimeout);
      if (refetchTimer !== null) clearTimeout(refetchTimer);
      activeSocket?.close();
    };
  }, [enabled, workspaceId, userId, queryClient]);
}
