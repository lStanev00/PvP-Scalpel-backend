import { Router } from "express";
import { jsonMessage, jsonResponse } from "../helpers/resposeHelpers.js";
import Char from "../Models/Chars.js";
import User from "../Models/User.js";
import { CharCacheEmitter } from "../caching/characters/charCache.js";
import MediaMeta from "../Models/MediaMeta.js";

const userActionCTRL = Router();

userActionCTRL.get(`/like/:entryID`, setLike);
userActionCTRL.get(`favorite/:charID`, setFavorite);



async function setLike(req, res) {
    const user = req.user;
    if (!user || !user._id) return jsonMessage(res, 401, "No user");
  
    const entryID = req.params.entryID;
    if (!entryID) return jsonMessage(res, 400, "Bad request");
  
    try {
        let DocType;
        const isItCharacter = await Char.findById(entryID);
        if(!isItCharacter) {
            const isItMedia = await MediaMeta.findById(entryID);
            if(!isItMedia) return jsonResponse(res, 404, "Entry not found");
            DocType = MediaMeta;
        } else {
            DocType = Char;
        }
        const alreadyLiked = await DocType.findOne({ _id: entryID, likes: user._id });
  
        const update = alreadyLiked
            ? { $pull: { likes: user._id } }
            : { $addToSet: { likes: user._id } };
  
        const updatedEntry = await Char.findByIdAndUpdate(entryID, update, { new: true });
        if(DocType === Char) CharCacheEmitter.emit("updateRequest", updatedEntry?.search);
        return res.status(200).json({ likesCount: updatedEntry.likes.length,  isLiked: (updatedEntry.likes).includes(user._id) });
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