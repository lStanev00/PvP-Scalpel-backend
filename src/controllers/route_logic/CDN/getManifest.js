import { CDNAUTH, CDNURI } from "./cdn.config";

export default async function pullManifest() {
    try {
        const req = await fetch(CDNURI + "/getManifest", {
            headers: {
                Authorization: `Bearer ${CDNAUTH}`,
            },

            method: "GET",
        });
        const data = await req.json();
        return data;
    } catch (error) {
        console.warn(error);
        return null;
    }
}
