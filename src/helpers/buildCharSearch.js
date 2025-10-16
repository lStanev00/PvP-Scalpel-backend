// @ts‑check
/**
 * Build a string of the form "Name:Realm:Server".
*
* @param   {string} server    — the raw search string
* @param   {string} realm    — the raw search string
* @param   {string} name    — the raw search string
* @returns {string}   — name:realm:server or undefined if invalid
*/

export default function buildCharSearch(server, realm, name) {
    server = server.toLowerCase().trim();
    realm = realm.toLowerCase().trim();
    name = name.toLowerCase().trim();
    

    return [name, realm, server].join(":");
}