import { Router } from "express";
import Post from "../Models/Post.js";


const postsCTRL = Router();

postsCTRL.post(`/new/post`, createPostPOST);
postsCTRL.delete(`/delete/post`, postDELETE);
postsCTRL.get(`/get/posts`, getPosts);
postsCTRL.patch(`/edit/post`, editPostPATCH);


async function editPostPATCH(req, res) {
    const user = req?.user;

    if (!user) {
        return res.status(403).end()
    }

    const {postID, content, title} = req.body;

    if (!postID || !content || !title) return res.status(400).json({msg:`Bad request`});

    let post = undefined;

    try {
        post = await Post.findById(postID).populate(`author`);
        
    } catch (error) {
        console.warn(error);
        return res.status(500).end();
    }

    if(!post) return res.status(404).end();
    
    if (!((user._id).equals(post?.author?._id))) return res.status(401).end();

    try {
        const newPostData = await Post.findByIdAndUpdate(postID, {
            $set: {
                content: content.trim(),
                title: title.trim()
            }
        },{ new: true })
        .populate({
            path: "author",
            select: "username _id"
        })
        .populate({
            path: "character",
            select: "name playerRealm media server _id"
        })
        .lean();
        return res.status(200).json(newPostData);
    } catch (error) {
        console.warn(error);
        return res.status(500).end();
    }

}

async function createPostPOST(req, res) {
    const user = req?.user;
    if(!user) return res.status(403).end();

    const {  title, content, authorID, characterID  } = req.body;
    if (!title || !content || !authorID || !characterID) return res.status(400).json({msg:`Please provide all the information to proceed`});

    try {
        const newPost = await new Post({
            title, content, author: authorID, character: characterID
        }).save();

        const popNewPost = await Post.findById(newPost.id).populate({
            path: "author",
            select : "username _id"
        });

        return res.status(201).json(popNewPost.toObject());
    } catch (error) {
        console.warn(error);
        return res.status(500).end();
    }
}

async function postDELETE(req, res) {
    const {postID} = req.body;
    const user = req.user;

    try {
        const post = await Post.findById(postID);
        if (!user._id.equals(post.author)) return res.status(400).end();

        await Post.findByIdAndDelete(postID);

        return res.status(200).end();

    } catch (error) {
        console.warn(error)
        return res.status(500).end();
    }
}

async function getPosts(req, res) {
    try {
        const postsList = await Post.find()
            .sort({ createdAt: -1 })
            .populate({
                path: "author",
                select: "username _id"
            })
            .populate({
                path: "character",
                select: "name playerRealm media server _id"
            })
            .lean();
        
        return res.status(200).json(postsList);
    } catch (error) {
        console.warn(error);
        return res.status(500).end()
    }
}

export default postsCTRL;