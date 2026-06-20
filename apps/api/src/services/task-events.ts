import { createNotificationClient } from "@gowith/db";

export interface AdminTaskEvent {
  type: "run.created" | "run.updated" | "pipeline.event";
  run_id: string;
  run_type?: string;
  entity_type: string;
  entity_id: string;
  status?: string;
  event_id?: string;
  stage?: string;
  event_type?: string;
  level?: string;
  progress_percent?: number | string | null;
  created_at?: string;
  updated_at?: string;
}

type Subscriber = (event: AdminTaskEvent) => void;

export class TaskEventBroker {
  private readonly subscribers = new Set<Subscriber>();
  private client = createNotificationClient();
  private stopped = false;

  async start() {
    await this.client.connect();
    this.client.on("notification", (message) => {
      if (!message.payload) return;
      try {
        const event = JSON.parse(message.payload) as AdminTaskEvent;
        for (const subscriber of this.subscribers) subscriber(event);
      } catch {
        // Ignore malformed database notifications; durable polling remains available.
      }
    });
    this.client.on("error", () => void this.reconnect());
    await this.client.query("LISTEN gowith_admin_tasks");
  }

  subscribe(subscriber: Subscriber) {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  async stop() {
    this.stopped = true;
    await this.client.end().catch(() => undefined);
  }

  private async reconnect() {
    if (this.stopped) return;
    await this.client.end().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (this.stopped) return;
    this.client = createNotificationClient();
    await this.start().catch(() => void this.reconnect());
  }
}
