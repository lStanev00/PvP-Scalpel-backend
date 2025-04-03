import mongoose, { Schema } from "mongoose";
import User from './User.js'
import Char from "./Chars.js";


const PostSchema = new mongoose.Schema({
    title : {
        type: String,
        required: true
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
    favorites : {
        type: Schema.Types.ObjectId,
        ref: Char,
        require : false,
    },
}, {timestamps: true});

PostSchema.index({ author: 1 });
PostSchema.index({ character: 1 });

const Post = mongoose.model(`Post`, PostSchema);
export default Post;