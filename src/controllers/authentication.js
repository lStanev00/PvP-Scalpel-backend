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
    console.log("Email: " + email, `\nUsername: ` + username);

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

            res.status(409).json(msg);

        }
        if (newUser === undefined) return;

        const token = jwt.sign(
            { userId: newUser._id, email: newUser.email },
            JWT_SECRET,
            { expiresIn: '10h' }
        );

        await mail.sendJWTAuth(email, token);
        waitingValidation[newUser._id] = true;


    } catch (error) {
        console.log(error)
        res.status(500).json({
            message: "Internal server Error. Please reprot."
        })
    }
}




export default authController;