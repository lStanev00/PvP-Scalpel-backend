import mongoose, { Schema } from "mongoose";
import User from './User.js'
import Char from "./Chars.js";


const PostSchema = new mongoose.Schema({
    title : {
        type: String,
        required: false
    },
    content: {
        type: String,
        required: true
    },
    author: {
        type: Schema.Types.ObjectId,
        ref: User,
        required: true
    },
    character : {
        type: Schema.Types.ObjectId,
        ref: Char,
        require : false,
    },
    media : {
        type: Schema.Types.ObjectId,
        ref: Char,
        require : false,
    },
    favorites : { // Usage ?
        type: Schema.Types.ObjectId,
        ref: Char,
        require : false,
    },
    likes: {
        type: [Schema.Types.ObjectId],
        ref: User,
        default: [],
    },
    replyTo: {
        type: Schema.Types.ObjectId,
        ref: "VideoComments",
        required: false,
    },
}, {timestamps: true});

PostSchema.index({ author: 1 });
PostSchema.index({ character: 1 });

const Post = mongoose.model(`Post`, PostSchema);
export default Post;