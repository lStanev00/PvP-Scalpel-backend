/**
 * @param {string} val
 * @returns {string | undefined}
 */
const sanitize = (val) => {
    if (typeof val !== "string") return undefined;
    val = val.trim().toLowerCase();
    if (val.length === 0) return undefined;
    return val;
};

// @ts-check
/**
 * Build a safe string of the form "name:realm:server".
 *
 * @param   {string} server  - Raw server name
 * @param   {string} realm   - Raw realm name
 * @param   {string} name    - Raw character name
 * @returns {string | undefined} Safe key (name:realm:server) or undefined if invalid
 */
export default function buildCharSearch(server, realm, name) {
    
    const safeServer = sanitize(server);
    const safeRealm = sanitize(realm);
    const safeName = sanitize(name);
    
    if (!safeServer || !safeRealm || !safeName) return undefined;
    
    return [safeName, safeRealm, safeServer].join(":");
}