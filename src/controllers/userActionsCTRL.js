import { Router } from "express";
import { jsonMessage } from "../helpers/resposeHelpers.js";
import Char from "../Models/Chars.js";

const userActionCTRL = Router();

userActionCTRL.post(`/like/:charID`, setLike);



async function setLike(req, res) {
    const user = req.user;
    if (!user || !user._id) return jsonMessage(res, 401, "No user");
  
    const charID = req.params.charID;
    if (!charID) return jsonMessage(res, 400, "Bad request");
  
    try {
        const alreadyLiked = await Char.findOne({ _id: charID, likes: user._id });
  
        const update = alreadyLiked
            ? { $pull: { likes: user._id } }
            : { $addToSet: { likes: user._id } };
  
        const updatedChar = await Char.findByIdAndUpdate(charID, update, { new: true });
  
        return res.status(200).json({ likes: updatedChar.likes.length });
    } catch (error) {
        console.warn(error);
        return jsonMessage(res, 500, "Internal Server Error");
    }
}
  

export default userActionCTRL;