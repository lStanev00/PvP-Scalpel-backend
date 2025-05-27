export function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function startBackgroundTask(fn, ms) {
  (async () => {
    while (true) {
      const success = await fn();
      if (success) {
      }
      await delay(ms);
    }
  })();
}
