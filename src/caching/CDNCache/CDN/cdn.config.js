import "dotenv/config";

export const CDNURI = "http://" + process.env.CDN_PRIVATE_DOMAIN + ":" + process.env.CDN_PORT;

export const CDNAUTH = process.env.JWT_CDN_PUBLIC;

export async function retriveCDNLink(keyId) {
    const response = await fetch(`${CDNURI}/presign/download`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${CDNAUTH}`,
        },
        body: JSON.stringify({
            keyId
        }),
    });

    return await response.json();
}
