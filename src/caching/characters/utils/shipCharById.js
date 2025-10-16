import Char from "../../../Models/Chars.js";

export default async function shipCharById(ID) {
    // ID = formReadableID(ID);

    try {
        let data = await Char.findById(ID);
        if (!data) return null;

        try {
            await data.populate({
                path: "posts",
                populate: {
                    path: "author",
                    select: "username _id",
                },
            });
        } catch (error) {
            // posts can be missing
        }
        await data.populate("listAchievements");
        data = data.toObject();

        return data;
    } catch (error) {
        console.warn(error);
    }
}
