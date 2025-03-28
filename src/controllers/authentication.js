import User from "../Models/User.js";
import { Router } from "express";
import jwt from 'jsonwebtoken'
import dotenv from 'dotenv';
import mail from "../mailer.js";
import { getOptions } from "../helpers/cookieOptions.js";
import bcrypt from 'bcrypt'
import validateToken from "../helpers/authToken.js";
const JWT_SECRET = process.env.JWT_SECRET

const authController = Router();

authController.post("/login", loginPost);
authController.post("/register", registerPost);
authController.post("/validate/token", valdiateTokenPost);
authController.get("/verify/me", (req,res) => res.status(200).end());

const waitingValidation = {};

async function loginPost(req, res) {
    const { email, password, fingerprint } = req.body;

    try {
        const attemptedUser = await User.findOne({email: email});
        if (!attemptedUser) return res.status(400).end();
        const isMatch = await attemptedUser.comparePassword(password);

        if (!isMatch) return res.status(400).end(); // Bad password

        const newUserFP = await User.findByIdAndUpdate(attemptedUser._id, {
            $set: {
                fingerprint: fingerprint
            }
        }, { new: true });

        const loginObject = getLogedObject(newUserFP);

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
            const codeHash = await cryptCode(code);
            const JWT = jwt.sign(
                { _id: newUser._id, email: newUser.email, fingerprint: newUser.fingerprint },
                JWT_SECRET,
                { expiresIn: '10h' }
            );
            newUser.verifyTokens = {
                email: {
                    token: codeHash,
                    JWT: JWT
                }
            }
            await newUser.save();
    
            res.status(201).json({ _id: newUser._id, email: newUser.email });
            return await mail.sendJWTAuth(email, code, "email");

        } catch (error) {
            const msg = {}

            try {
                const emailExist = await User.findOne({email : email});
                const usernameExist = await User.findOne({username : username});
    
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

async function valdiateTokenPost(req, res) {
    const { token, option } = req.body;
    const JWT = req.JWT;
    let user = req.user;

    if (user) {
        if (option == `verify`) {
            if (user.email && user.email.JWT === JWT && user.email.token) {
                if (!bcrypt.compare(token, user.email.token)) return res.status(401).end();
                try {
                    const updatedUser = await User.findByIdAndUpdate(user._id, {
                        $set: {
                          isVerified: true
                        },
                        $unset: {
                          'verifyTokens.email': ''
                        }
                    }, { new: true});

                    const loginObject = getLogedObject(updatedUser);

                    const jwtToken = jwt.sign(loginObject, JWT_SECRET);
                    const options = getOptions(req);

                    res
                        .clearCookie("token", options)
                        .cookie("token", jwtToken, options)
                        .status(201)
                        .json(loginObject);
                      
                } catch (error) {
                    return res.status(500).end();
                }
            } else return res.status(400).end();
        }
    }
}
export default authController;


function genCode() { // Generates a 6 digit code
    return Math.floor(100000 + Math.random() * 900000);
}

function getLogedObject(user) {
    return {
        _id: user._id,
        email: user.email,
        username: user.username,
        isVerified: user.isVerified,
        role: user.role,
        fingerprint: user.fingerprint,
    }
}


async function cryptCode(code) {
    const salt = 12;
    const codeHash = await bcrypt.hash(code, salt);
    return codeHash
}