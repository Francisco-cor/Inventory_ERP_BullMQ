import "@testing-library/jest-dom";

// jsdom no tiene scrollIntoView
if (!Element.prototype.scrollIntoView) {
  (Element.prototype as unknown as Record<string, unknown>).scrollIntoView = () => {};
}

// recharts necesita ResizeObserver en jsdom
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

globalThis.EventSource = class {
  url: string;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  private listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  constructor(url: string) {
    this.url = url;
    setTimeout(() => this.onopen?.(new Event("open")), 0);
  }
  addEventListener(type: string, cb: (e: MessageEvent) => void) {
    this.listeners[type] = [...(this.listeners[type] ?? []), cb];
  }
  removeEventListener() {}
  close() {}
  dispatch(type: string, data: unknown) {
    const ev = new MessageEvent(type, { data: JSON.stringify(data) });
    (this.listeners[type] ?? []).forEach((cb) => cb(ev));
    if (type === "event") this.onmessage?.(ev);
  }
} as unknown as typeof EventSource;
