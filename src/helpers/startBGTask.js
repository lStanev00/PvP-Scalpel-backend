export function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function startBackgroundTask(fn, ms) {
  (async () => {
    while (true) {
      console.time(`${fn.name}`)
      const success = await fn();
      if (success) {
        console.timeEnd(`${fn.name}`)
      }
      await delay(ms);
    }
  })();
}
