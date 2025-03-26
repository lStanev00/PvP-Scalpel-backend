import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
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
    },
    isVerified: {
        type: Boolean,
        default: false,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    // Other TODO functionalities
    role: { // MISSING FUNC
        type: String,
        enum: ['user', 'admin'],
        default: 'user',
    },
    avatarUrl: String, // MISSING FUNC
});

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

    // TODO Browser footprint validation logic (and storing) !! BUT USER AGREEMENT 1ST !!
};

const User = mongoose.model('User', userSchema);
export default User;
