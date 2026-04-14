import slugify from "./slugify.js";

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
 * @param   {{ server: string, realm: string, name: string }} params - Raw character search parts.
 * @returns {string | undefined} Safe key (name:realm:server) or undefined if invalid
 */
export default function buildCharSearch(params) {
    const { server, realm, name } = params ?? {};
    
    const safeServer = sanitize(server);
    const safeRealm = slugify(realm);
    const safeName = sanitize(name);
    
    if (!safeServer || !safeRealm || !safeName) return undefined;
    
    return [safeName, safeRealm, safeServer].join(":");
}
