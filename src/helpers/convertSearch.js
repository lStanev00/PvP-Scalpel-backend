export default function convertSearch(search) {
    if (typeof search !== "string") {
        console.warn(search + "'s not a string!");
        return undefined
    }

    search = search.toLowerCase();
    let [name, realm, server] = search.split(":");

    name = name.trim();
    realm = realm.trim();
    server = server.trim();

    const result = [name, realm, server];
    return result
}