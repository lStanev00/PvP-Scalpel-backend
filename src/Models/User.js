import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        select: false
    },
    username: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
    },
    password: {
        type: String,
        required: true,
        select: false
    },
    isVerified: {
        type: Boolean,
        default: false,
        select: false
    },
    createdAt: {
        type: Date,
        default: Date.now,
        select: false
    },
    fingerprint: {type: mongoose.Schema.Types.Mixed, required: true, select: false},
    verifyTokens : {
        type : {
            email : {
                token : {type : String, required:false, select: false},
                JWT : {type : String, required:false, select: false},
            },
            newEmail : {
                token : {type : String, required:false, select: false},
                newEmail : {type : String, required:false, select: false},
            },
            password: {
                JWT: {type : String, required: false, select: false},
                fingerprint: {type : mongoose.Schema.Types.Mixed, required: false, select: false},
            },
        },
        default: () => ({}),
        _id: false,

    },
    role: { 
        type: String,
        enum: ['user', 'admin'],
        default: 'user',
        select: false
    },
    // Other TODO functionalities
    avatarUrl: String, // MISSING FUNC
});


userSchema.virtual("posts", {
    ref: "Post",
    localField: "_id",
    foreignField: "author",
});


userSchema.set("toObject", {  virtuals: true  });
userSchema.set("toJSON", {  virtuals: true  });

// Pre save for pass hash ! PASSWORDS CAN'T BE RAW STRING (AS IS) STORRED !
userSchema.pre('save', async function (next) {
    if(!this.isModified('password')) return next(); // If pass noMod

    try {
        const salt = 12;
        const hashedPassword = await bcrypt.hash(this.password, salt);
        this.password = hashedPassword;
        next();
    } catch (error) {next(error)}
});

// Method for validating password input on login
userSchema.methods.comparePassword = function (candidatePassword) {

    return bcrypt.compare(candidatePassword, this.password);

};

const User = mongoose.model('User', userSchema);
export default User;
