import { model, Schema } from "mongoose";

const GameClassModel = new Schema(
    {
        _id: Number,
        name: {
            type: String,
            required: [true, "Name is required"],
        },
        media: {
            type: String,
            required: [true, "Media string href is required"],
        },
    },
    {
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

GameClassModel.virtual("specs", {
    ref: "GameSpecialization",
    localField: "_id",
    foreignField: "relClass",
    justOne: false,
});

GameClassModel.pre(/^find/, function (next) {
    this.populate("specs");
    next();
});


GameClassModel.set("toObject", {  virtuals: true  });
GameClassModel.set("toJSON", {  virtuals: true  });


const GameClass = model("GameClass", GameClassModel);
export default GameClass;
