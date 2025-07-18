// @ts‑check
/**
 * Split a string of the form "Name:Realm:Server" into its pieces.
 *
 * @param   {string} search    — the raw search string
 * @returns {[string, string, string]|undefined}   — [name, realm, server] or undefined if invalid
 */

export default function convertSearch(search) {
    if (typeof search !== "string") {
        console.warn(search + "'s not a string!");
        return undefined
    } else if (typeof search === "string") {

        search = search.toLowerCase();
        let [name, realm, server] = search.split(":");
    
        name = name.trim();
        realm = realm.trim();
        server = server.trim();

        if(typeof name === "string" && typeof realm === "string" && typeof server === "string") {

            const result = [name, realm, server];
            return result
        }
    }

    return undefined

    
}