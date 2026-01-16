import "dotenv/config";
const CDNURI = "http://" + process.env.CDN_PRIVATE_DOMAIN;
const AUTH = process.env.JWT_CDN_PUBLIC;

export default async function pullManifest() {
    try {
        const req = await fetch(CDNURI + "/getManifest", {
            headers: { 
                autorization: `Bearer ${AUTH}`
            },
            method: "GET"
        });
        const data = await req.json();
        return data
    } catch (error) {
        console.warn(error);
        return null;
    }
}
