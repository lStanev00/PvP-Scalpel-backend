import assert from "node:assert/strict";
import test from "node:test";

process.env.CDN_PRIVATE_DOMAIN = "legacy-storage";
process.env.CDN_PORT = "4002";
process.env.STORAGE_REST_ENDPOINT = "http://storage:4002";
process.env.JWT_CDN_PUBLIC = "test-delete-token";

const { deleteCDNObjects } = await import(
    "../src/caching/CDNCache/CDN/cdn.config.js"
);

test("deletes quarantine keys through the internal storage REST service", async (t) => {
    const originalFetch = globalThis.fetch;
    t.after(() => {
        globalThis.fetch = originalFetch;
    });

    globalThis.fetch = async (url, options) => {
        assert.equal(url, "http://storage:4002/objects");
        assert.equal(options.method, "DELETE");
        assert.equal(
            options.headers.Authorization,
            "Bearer test-delete-token",
        );
        assert.deepEqual(JSON.parse(options.body), {
            bucket: "quarantine-uploads",
            keyIds: ["videos/507f1f77bcf86cd799439011/part_0"],
        });

        return new Response(
            JSON.stringify({
                succeed: true,
                deletedKeys: [
                    "videos/507f1f77bcf86cd799439011/part_0",
                ],
                failedKeys: [],
            }),
            {
                status: 200,
                headers: {
                    "Content-Type": "application/json",
                },
            },
        );
    };

    const result = await deleteCDNObjects({
        bucket: "quarantine-uploads",
        keyIds: ["videos/507f1f77bcf86cd799439011/part_0"],
    });

    assert.equal(result.succeed, true);
    assert.deepEqual(result.failedKeys, []);
});

test("refuses destructive requests without the shared storage token", async () => {
    const token = process.env.JWT_CDN_PUBLIC;
    delete process.env.JWT_CDN_PUBLIC;

    try {
        await assert.rejects(
            deleteCDNObjects({
                bucket: "quarantine-uploads",
                keyIds: ["videos/507f1f77bcf86cd799439011/part_0"],
            }),
            /requires JWT_CDN_PUBLIC/,
        );
    } finally {
        process.env.JWT_CDN_PUBLIC = token;
    }
});
