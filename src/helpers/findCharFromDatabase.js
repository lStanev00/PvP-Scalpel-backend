import Char from "../Models/Chars.js";

export default async function findCharFromDatabase(server, realm, name) {
    let character = undefined;

    try {
        character = await Char.findOne({
            name: name,
            "playerRealm.slug": realm,
            server: server,
        });
        if (character) return character;
    } catch (error) {
        console.warn(error);
    }
    return null;
}