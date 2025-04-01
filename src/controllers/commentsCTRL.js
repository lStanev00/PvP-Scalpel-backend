import { Router } from "express";
import Post from "../Models/Post.js";


const commentsCTRL = Router();


async function createPostPOST(req, res) {
    const user = req?.user;
    if(!user) return res.status(403).end();

    const {  title, content, authorID, characterID  } = req.body;
    if (!title || !content || !authorID || !characterID) return res.status(400).json({msg:`Please provide all the information to procee`});

    try {
        const newPost = await new Post({
            title, content, author: authorID, character: characterID
        }).save();

        const popNewPost = await newPost.populate("character").populate("author");

        return res.status(201).json(popNewPost.toObject());
    } catch (error) {
        console.warn(error);
        return res.status(500).end();
    }

}

export default commentsCTRL;