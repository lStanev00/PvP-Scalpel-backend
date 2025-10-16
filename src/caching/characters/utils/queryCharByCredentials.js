import Char from "../../../Models/Chars";

export default async function queryCharacterByCredentials(server, realm, name) {
    try {
        const character = await Char.findOne({
            name: new RegExp(`^${name}$`, "i"),
            "playerRealm.slug": realm,
            server: server,
        }).lean();
        return character;
    } catch (error) {return null}
}
