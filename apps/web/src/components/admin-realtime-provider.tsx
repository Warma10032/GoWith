"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { apiBaseUrl } from "@/lib/api";
import {
  adminFetch,
  isTaskAccepted,
  type TaskAcceptedResponse,
} from "@/lib/admin-api";

type ConnectionState = "connecting" | "connected" | "fallback";
type RunStatus = "queued" | "running" | "success" | "failed" | "cancelled";

export interface AdminTaskEvent {
  type: "run.created" | "run.updated" | "pipeline.event";
  run_id: string;
  run_type?: string;
  entity_type: string;
  entity_id: string;
  status?: RunStatus;
  event_id?: string;
  stage?: string;
  event_type?: string;
  level?: string;
  progress_percent?: number | string | null;
  created_at?: string;
  updated_at?: string;
}

interface RunChange {
  id: string;
  run_type: string;
  entity_type: string;
  entity_id: string;
  status: RunStatus;
  updated_at: string;
}

interface EventChange {
  id: string;
  run_id: string;
  entity_type: string;
  entity_id: string;
  stage: string;
  event_type: string;
  level: string;
  progress_percent?: number | string | null;
  created_at: string;
}

interface RealtimeContextValue {
  connectionState: ConnectionState;
  activeRuns: ReadonlyMap<string, AdminTaskEvent>;
  lastResult: AdminTaskEvent | null;
  waitForTask: (task: TaskAcceptedResponse) => Promise<AdminTaskEvent>;
  subscribe: (listener: (event: AdminTaskEvent) => void) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);
const TERMINAL = new Set<RunStatus>(["success", "failed", "cancelled"]);

function RealtimeRuntime({ children }: { children: ReactNode }) {
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [activeRuns, setActiveRuns] = useState<Map<string, AdminTaskEvent>>(() => new Map());
  const [lastResult, setLastResult] = useState<AdminTaskEvent | null>(null);
  const listeners = useRef(new Set<(event: AdminTaskEvent) => void>());
  const statuses = useRef(new Map<string, AdminTaskEvent>());
  const waiters = useRef(new Map<string, Array<(event: AdminTaskEvent) => void>>());
  const cursor = useRef(new Date().toISOString());

  const processEvent = useCallback(
    (event: AdminTaskEvent) => {
      if (event.type !== "pipeline.event" && event.status) {
        statuses.current.set(event.run_id, event);
        if (TERMINAL.has(event.status)) {
          setActiveRuns((current) => {
            const next = new Map(current);
            next.delete(event.run_id);
            return next;
          });
          setLastResult(event);
          for (const resolve of waiters.current.get(event.run_id) ?? []) resolve(event);
          waiters.current.delete(event.run_id);
        } else {
          setActiveRuns((current) => new Map(current).set(event.run_id, event));
        }
      }
      for (const listener of listeners.current) listener(event);
    },
    [],
  );

  const pollChanges = useCallback(async () => {
    const payload = await adminFetch<{
      runs: RunChange[];
      events: EventChange[];
      next_cursor: string;
    }>(`/api/admin/pipeline-runs/changes?since=${encodeURIComponent(cursor.current)}`);
    for (const run of payload.runs) {
      processEvent({
        type: "run.updated",
        run_id: run.id,
        run_type: run.run_type,
        entity_type: run.entity_type,
        entity_id: run.entity_id,
        status: run.status,
        updated_at: run.updated_at,
      });
    }
    for (const event of payload.events) {
      processEvent({
        type: "pipeline.event",
        event_id: event.id,
        run_id: event.run_id,
        entity_type: event.entity_type,
        entity_id: event.entity_id,
        stage: event.stage,
        event_type: event.event_type,
        level: event.level,
        progress_percent: event.progress_percent,
        created_at: event.created_at,
      });
    }
    cursor.current = payload.next_cursor;
  }, [processEvent]);

  useEffect(() => {
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let retryMs = 1000;
    const connect = () => {
      if (stopped) return;
      setConnectionState("connecting");
      source = new EventSource(`${apiBaseUrl}/api/admin/task-stream`, {
        withCredentials: true,
      });
      source.addEventListener("ready", () => {
        retryMs = 1000;
        setConnectionState("connected");
        void pollChanges().catch(() => undefined);
      });
      for (const type of ["run.created", "run.updated", "pipeline.event"]) {
        source.addEventListener(type, (message) => {
          processEvent(JSON.parse((message as MessageEvent).data) as AdminTaskEvent);
        });
      }
      source.onerror = () => {
        source?.close();
        setConnectionState("fallback");
        reconnectTimer = setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 30_000);
      };
    };
    connect();
    const fallbackTimer = setInterval(() => {
      void pollChanges().catch(() => setConnectionState("fallback"));
    }, 10_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void pollChanges().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      source?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearInterval(fallbackTimer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pollChanges, processEvent]);

  const waitForTask = useCallback((task: TaskAcceptedResponse) => {
    const known = statuses.current.get(task.run_id);
    if (known?.status && TERMINAL.has(known.status)) return Promise.resolve(known);
    const initial: AdminTaskEvent = {
      type: "run.created",
      run_id: task.run_id,
      run_type: task.run_type,
      entity_type: task.entity_type,
      entity_id: task.entity_id,
      status: task.status,
    };
    statuses.current.set(task.run_id, initial);
    setActiveRuns((current) => new Map(current).set(task.run_id, initial));
    return new Promise<AdminTaskEvent>((resolve) => {
      const current = waiters.current.get(task.run_id) ?? [];
      waiters.current.set(task.run_id, [...current, resolve]);
    });
  }, []);

  const subscribe = useCallback((listener: (event: AdminTaskEvent) => void) => {
    listeners.current.add(listener);
    return () => listeners.current.delete(listener);
  }, []);

  const value = useMemo(
    () => ({ connectionState, activeRuns, lastResult, waitForTask, subscribe }),
    [activeRuns, connectionState, lastResult, subscribe, waitForTask],
  );
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function AdminRealtimeProvider({ children }: { children: ReactNode }) {
  return <RealtimeRuntime>{children}</RealtimeRuntime>;
}

export function useAdminRealtime() {
  const value = useContext(RealtimeContext);
  if (!value) throw new Error("useAdminRealtime must be used inside AdminRealtimeProvider");
  return value;
}

export function useAdminTaskMutation() {
  const { waitForTask } = useAdminRealtime();

  const runTask = useCallback(
    async <T,>(
      action: () => Promise<T>,
      options: { onAccepted?: (task: TaskAcceptedResponse) => void | Promise<void> } = {},
    ): Promise<T> => {
      const result = await action();
      if (!isTaskAccepted(result)) return result;

      await options.onAccepted?.(result);
      const terminal = await waitForTask(result);
      if (terminal.status !== "success") {
        throw new Error(`后台任务${terminal.status === "cancelled" ? "已取消" : "执行失败"}`);
      }
      return result;
    },
    [waitForTask],
  );

  return { runTask };
}

export function useAdminRealtimeRefresh(
  refresh: () => void | Promise<void>,
  options: { progress?: boolean } = {},
) {
  const { subscribe } = useAdminRealtime();
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(
    () =>
      subscribe((event) => {
        if (options.progress || (event.status && TERMINAL.has(event.status))) {
          void refreshRef.current();
        }
      }),
    [options.progress, subscribe],
  );
}
