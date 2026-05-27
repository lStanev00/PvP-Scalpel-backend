import "dotenv/config";

export const CDNURI = "http://" + process.env.CDN_PRIVATE_DOMAIN + ":" + process.env.CDN_PORT;

// export const CDNAUTH = process.env.JWT_CDN_PUBLIC;
export const CDNAUTH = "2x5ZLnz88q3YdSL0N8yWxEZ_T53xQ6_VzXpdEX-i2x5ZLnz88q3PVP_PUBLICC468JFD4H6SG85ADFS65489HG7F6453B1";

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
