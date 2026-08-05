import { Response } from 'express';
import { AttendancePunchRepository } from '../repositories/AttendancePunchRepository';

/**
 * Real-time punch feed over Server-Sent Events.
 *
 * SSE rather than WebSockets: the feed is one-directional, it rides the
 * existing HTTP stack with no extra dependency or port, and browsers reconnect
 * on their own. A WebSocket would add a package and a second protocol for a
 * stream that only ever flows one way.
 *
 * Scale note: this keeps subscribers in process memory, so behind more than one
 * Node instance each instance serves only its own clients. That is correct but
 * not shared -- a fan-out across instances needs a broker, which is not
 * configured here.
 */

interface Subscriber {
  id: number;
  res: Response;
  lastPunchId: number;
}

const POLL_INTERVAL_MS = 3000;
const HEARTBEAT_MS = 25000;
const MAX_SUBSCRIBERS = 200;

export class AttendanceLiveService {
  private static instance: AttendanceLiveService | null = null;
  private punchRepo = new AttendancePunchRepository();
  private subscribers = new Map<number, Subscriber>();
  private nextId = 1;
  private timer: NodeJS.Timeout | null = null;
  private heartbeat: NodeJS.Timeout | null = null;

  static shared(): AttendanceLiveService {
    if (!this.instance) this.instance = new AttendanceLiveService();
    return this.instance;
  }

  subscribe(res: Response, sinceId?: number): () => void {
    if (this.subscribers.size >= MAX_SUBSCRIBERS) {
      throw new Error(`The live feed is at its limit of ${MAX_SUBSCRIBERS} concurrent subscribers`);
    }

    const id = this.nextId++;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Tells nginx and friends not to buffer the stream.
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 5000\n\n`);
    res.write(`event: connected\ndata: ${JSON.stringify({ subscriberId: id, pollIntervalMs: POLL_INTERVAL_MS })}\n\n`);

    this.subscribers.set(id, { id, res, lastPunchId: Number(sinceId ?? 0) || 0 });
    this.start();

    return () => {
      this.subscribers.delete(id);
      if (!this.subscribers.size) this.stop();
    };
  }

  private start(): void {
    if (this.timer) return;

    this.timer = setInterval(() => { void this.poll(); }, POLL_INTERVAL_MS);
    this.heartbeat = setInterval(() => {
      // A comment line keeps proxies from closing an idle connection.
      for (const sub of this.subscribers.values()) sub.res.write(': keep-alive\n\n');
    }, HEARTBEAT_MS);

    // Never hold the process open for the sake of the feed.
    this.timer.unref?.();
    this.heartbeat.unref?.();
  }

  private stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
  }

  private async poll(): Promise<void> {
    if (!this.subscribers.size) return;

    // One query for the whole room, filtered per subscriber afterwards.
    const lowest = Math.min(...Array.from(this.subscribers.values(), (s) => s.lastPunchId));
    let punches;
    try {
      punches = await this.punchRepo.findRecent(50, lowest || undefined);
    } catch (err: any) {
      for (const sub of this.subscribers.values()) {
        sub.res.write(`event: error\ndata: ${JSON.stringify({ message: err?.message ?? 'Feed query failed' })}\n\n`);
      }
      return;
    }
    if (!punches.length) return;

    const ascending = [...punches].sort((a, b) => a.id - b.id);
    const maxId = ascending[ascending.length - 1]!.id;

    for (const sub of this.subscribers.values()) {
      const fresh = ascending.filter((p) => p.id > sub.lastPunchId);
      if (!fresh.length) continue;
      try {
        sub.res.write(`id: ${maxId}\nevent: punch\ndata: ${JSON.stringify(fresh)}\n\n`);
        sub.lastPunchId = maxId;
      } catch {
        this.subscribers.delete(sub.id);
      }
    }
    if (!this.subscribers.size) this.stop();
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }
}
