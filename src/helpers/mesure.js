export default async function measure(label, fn) {
    const start = new Date();
    const result = await fn();
    console.info(`${label} took ${new Date() - start} ms`);
    return result;
}