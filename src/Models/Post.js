import mongoose, { mongo, Schema } from "mongoose";

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
        ref: "User",
        required: true
    },
    character : {
        type: Schema.Types.ObjectId,
        ref: "Char",
        require : false,
    }
});

PostSchema.index({ author: 1});
PostSchema.index({ character: 1})

const Post = mongoose.model(`Post`, PostSchema);
export default Post;