/**
 * DiscordIDs model
 *
 * Stores one document per unique Discord snowflake ID. The document `_id` is
 * the raw Discord user ID string, not a Mongo ObjectId.
 *
 * Relationship ownership lives on the User model:
 * - User.discordIDs stores an array of DiscordIDs `_id` string refs.
 * - DiscordIDs.user is a virtual reverse population for the single linked user.
 *
 * Query middleware populates `user` for all find queries, so callers can use
 * `discordIDDoc.user` after `find`, `findOne`, or `findById`.
 */
import { model, Schema } from "mongoose";

const DiscordIDsSchema = new Schema(
    {
        _id: {
            type: String,
            required: true,
            unique: true,
        },
    },
    { versionKey: false },
);

DiscordIDsSchema.virtual("user", {
    ref: "User",
    localField: "_id",
    foreignField: "discordIDs",
    justOne: true,
});

DiscordIDsSchema.pre(/^find/, function (next) {
    this.populate("user");
    next();
});

DiscordIDsSchema.set("toObject", { virtuals: true });
DiscordIDsSchema.set("toJSON", { virtuals: true });

const DiscordIDs = model("DiscordIDs", DiscordIDsSchema);
export default DiscordIDs;
