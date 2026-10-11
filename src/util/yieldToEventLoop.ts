// Lets queued messages (e.g. interrupts) and rendering run, like setTimeout(0) but without the ~4ms clamp that
// browsers apply to nested timers. That clamp dominated generation time, since we yield once per face.

const channel = new MessageChannel();
const pendingResolves: (() => void)[] = [];

channel.port1.onmessage = () => {
  pendingResolves.shift()!();
};

export const yieldToEventLoop = (): Promise<void> => {
  return new Promise((resolve) => {
    pendingResolves.push(resolve);
    channel.port2.postMessage(null);
  });
};
