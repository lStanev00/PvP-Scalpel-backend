import User from "../Models/User.js";
import { Router } from "express";
import jwt from 'jsonwebtoken'
import dotenv from 'dotenv';
import mail from "../mailer.js";
import validateToken from "../helpers/authToken.js";
import { getOptions } from "../helpers/cookieOptions.js";
import { fingerprintsMatch } from "../middlewares/authMiddleweare.js";
const JWT_SECRET = process.env.JWT_SECRET

const authController = Router();

authController.post("/login", loginPost);
authController.post("/register", registerPost);
authController.post("/validate/email", valdiateEmailPost);
authController.post("/verify/session", verifySessionPost);

const waitingValidation = {};

async function loginPost(req, res) {
    const { email, password, fingerprint } = req.body;
    const auth1 = req.headers["600"];
    if (!auth1 && auth1 !== "BasicPass") return res.status(500).end();

    try {
        const attemptedUser = await User.findOne({email: email});
        if (!attemptedUser) return res.status(400).end();
        const isMatch = await attemptedUser.comparePassword(password);

        if (!isMatch) return res.status(400).end(); // Bad password

        const newUserFP = await User.findByIdAndUpdate(attemptedUser._id, {
            $set: {
                fingerprint: fingerprint
            }
        }, { new: true }).lean();

        const loginObject = {
            _id: newUserFP._id,
            email: newUserFP.email,
            username: newUserFP.username,
            isVerified: newUserFP.isVerified,
            role: newUserFP.role,
            fingerprint: newUserFP.fingerprint,
        }

        const jwtToken = jwt.sign(loginObject, JWT_SECRET);
        const options = getOptions(req);
        res.cookie("token", jwtToken, options);
          
        return res.status(200).json(loginObject);

    } catch (error) {
        console.warn(error)
        return res.status(500).end();
    }
}

async function registerPost(req, res) {
    const { email, username, password, fingerprint } = req.body;
    const auth1 = req.headers["600"];
    if (!auth1 && auth1 !== "BasicPass") return res.status(500).end();

    try {
        let newUser = undefined;
        try {
            newUser = new User({
                email: email,
                username: username,
                password: password,
                fingerprint: fingerprint,
            });
            const code = genCode();
            const JWT = jwt.sign(
                { _id: newUser._id, email: newUser.email, fingerprint: newUser.fingerprint },
                JWT_SECRET,
                { expiresIn: '10h' }
            );
            newUser.verifyTokens = {
                email: {
                    token: code,
                    JWT: JWT
                }
            }
            await newUser.save();
    
            res.status(201).json({ _id: newUser._id, email: newUser.email });
            return await mail.sendJWTAuth(email, token, "email");

        } catch (error) {
            const msg = {}

            try {
                const emailExist = await User.findOne({email : email}).lean();
                const usernameExist = await User.findOne({username : username}).lean();
    
                if (emailExist) msg.email = emailExist.email; 
                if (usernameExist) msg.username = usernameExist.username; 
    
                return res.status(409).json(msg);
                
            } catch (error) {
                console.warn(error);
                return res.status(500).json(msg);
            }


        }

    } catch (error) {
        console.log(error)
        res.status(500).json({
            message: "Internal server Error. Please report."
        })
    }
}

async function valdiateEmailPost(req, res) {
    const { token, fingerprint } = req.body;

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
                fingerprint: fingerprint
            },
        },
        { new: true });

        const loginObject = {
            _id: user._id,
            email: user.email,
            username: user.username,
            isVerified: user.isVerified,
            role: user.role,
            fingerprint: user.fingerprint,
        }

        const jwtToken = jwt.sign(loginObject, JWT_SECRET);
        const options = getOptions(req);

        res.cookie("token", jwtToken, options);
          
        res.status(201).json(loginObject);
        return delete waitingValidation[user._id];
    } catch (error) {
        console.log(error)
        return res.status(500).json({message: "Internal Server Error"})
    }
}

async function verifySessionPost(req, res) {
    const { _id, fingerprint } = req.body;

    try {
        const user = await User.findById(_id);

        if(!fingerprintsMatch(fingerprint, user.fingerprint)) return res.status(403).json({authorized: false});

        return res.status(200).json({authorized: true});

    } catch (error) {
        return res.status(500).end();
    }
    
}

export default authController;


function genCode() { // Generates a 6 digit code
    return Math.floor(100000 + Math.random() * 900000);
}