import User from "../Models/User.js";
import { Router } from "express";
import jwt from 'jsonwebtoken'
import dotenv from 'dotenv';
import mail from "../mailer.js";
import validateToken from "../helpers/authToken.js";
const JWT_SECRET = process.env.JWT_SECRET

const authController = Router();

authController.post("/register", registerPost);
authController.post("/validate/email", valdiateEmailPost);

const waitingValidation = {};
async function registerPost(req, res) {
    const { email, username, password } = req.body;
    const auth1 = req.headers["600"];
    if (!auth1) return res.status(500).end();
    if (auth1 !== "BasicPass") return res.status(500).end();

    try {
        let newUser = undefined;
        try {
            newUser = new User({
                email: email,
                username: username,
                password: password
            });
    
            await newUser.save();
            res.status(201).json({ _id: newUser._id, email: newUser.email });
            
        } catch (error) {
            const msg = {}

            const emailExist = User.findOne({email : email});
            const usernameExist = User.findOne({username : username});

            if (emailExist) msg.email = email; 
            if (usernameExist) msg.username = username; 

            return res.status(409).json(msg);

        }
        if (newUser === undefined) return;

        const token = jwt.sign(
            { _id: newUser._id, email: newUser.email },
            JWT_SECRET,
            { expiresIn: '10h' }
        );

        await mail.sendJWTAuth(email, token);
        waitingValidation[newUser._id] = true;


    } catch (error) {
        console.log(error)
        res.status(500).json({
            message: "Internal server Error. Please report."
        })
    }
}

async function valdiateEmailPost(req, res) {
    const token = req.body.token;

    const userData = validateToken(token, JWT_SECRET);

    if (!userData) return res.status(403).json({message: "Forbidden"});

    let user = undefined;
    try {
        user = await User.findById(userData._id);
    } catch (error) {
        return res.status(400).json({
            400: `the Token: ${token} is invalid`
        });
    };

    if(user) {
        if (!waitingValidation[user._id]) return res.status(403).json({message: "Forbidden"});
    };

    try {
        user = await User.findByIdAndUpdate(userData._id, {
            $set: {
                isVerified: true,
            },
        },
        { new: true });
        res.status(201).json({
            _id: user._id,
            username: user.username,
            email: user.email,
            isVerified: user.isVerified,
            role: user.role
        });
        return delete waitingValidation[user._id];
    } catch (error) {
        console.log(error)
        return res.status(500).json({message: "Internal Server Error"})
    }
}


export default authController;