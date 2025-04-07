import { Router } from "express";
import { jsonMessage } from "../helpers/resposeHelpers.js";
import Char from "../Models/Chars.js";
import User from "../Models/User.js";

const userActionCTRL = Router();

userActionCTRL.get(`/like/:charID`, setLike);
userActionCTRL.get(`favorite/:charID`, setFavorite);



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
  
        return res.status(200).json({ likesCount: updatedChar.likes.length,  isLiked: (updatedChar.likes).includes(user._id) });
    } catch (error) {
        console.warn(error);
        return jsonMessage(res, 500, "Internal Server Error");
    }
}

async function setFavorite(req, res) {
    const user = req.user;
    if (!user || !user._id) return jsonMessage(res, 401, "No user");
  
    const charID = req.params.charID;
    if (!charID) return jsonMessage(res, 400, "Bad request");

    try {
        const alreadyFavorited = await User.findOne({ _id: user._id, favChars: charID });

        const update = alreadyFavorited
            ? { $pull: { favChars: charID } }
            : { $addToSet: { favChars: charID } }

        const updatedUser = await User.findByIdAndUpdate(user._id, update, {  new: true  });

        const newFavList = updatedUser.favChars;

        return jsonMessage(res, 200, newFavList);
    } catch (error) {
        console.warn(error);
        return jsonMessage(res, 500, "Server error");
    }
    
}
  

export default userActionCTRL;