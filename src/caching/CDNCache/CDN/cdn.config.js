import "dotenv/config";

export const CDNURI = "http://" + process.env.CDN_PRIVATE_DOMAIN + ":" + process.env.CDN_PORT;

export const CDNAUTH = process.env.JWT_CDN_PUBLIC;

export async function retriveCDNLink(keyId) {
    const path = `${CDNURI.endsWith("/") ? "" : "/"}presign/download`
    const response = await fetch(CDNURI + path, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${CDNAUTH}`,
        },
        body: JSON.stringify({
            keyId
        })
    });

    return await response.json()
}
