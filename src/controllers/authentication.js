import User from "../Models/User.js";
import { Router } from "express";
import jwt from 'jsonwebtoken'
import mail from "../mailer.js";
import { getOptions } from "../helpers/cookieOptions.js";
import bcrypt from 'bcrypt'
import validateToken from "../helpers/authToken.js";
const JWT_SECRET = process.env.JWT_SECRET

const authController = Router();

authController.post("/login", loginPost);
authController.post("/register", registerPost);
authController.patch("/change/email", changeEmailPatch);
authController.patch("/change/password", changePassowordPatch);
authController.patch("/change/username", changeUsernamePatch);
authController.post("/reset/password", resetPasswordPost);
authController.patch("/reset/password", resetPasswordPatch);
authController.patch("/validate/token", valdiateTokenPatch);
authController.get("/verify/me", getMe);
authController.get("/logout", logoutGet);


async function logoutGet(req, res) {
    if (req.cookies) {
        const deleteOptions = getOptions(req);
        delete deleteOptions.maxAge;

        res.clearCookie(`token`, deleteOptions);
    }

    return res.status(200).end();
}

async function changeUsernamePatch(req, res) {
    const user = req?.user;
    const {newUsername} = req.body;

    if (!user) {
        if (req.cookies) {
            let options = getOptions(req);
            delete options.maxAge;
            res.clearCookie(`token`, options);
        }
        return res.status(403).end();
    }

    if ( !newUsername || newUsername === user.username ) return res.status(400).json({msg:`Please provide new username`})

    try {
        const usernameExist = await User.findOne({username: newUsername}).lean();
        if (usernameExist) return res.status(409).json({ msg: `User with username "${newUsername}" already exists. Please choose another one.` });
    } catch (error) {
        console.warn(error);
        return res.status(500).end();
    }

    try {
        let newUName = newUsername.trim();
        const updatedUser = await User.findByIdAndUpdate(user.id, {
            $set: {
                username: newUName,
            }
        }, {  new: true  });

        let deleteOptions = getOptions(req);
        const newCookieOptions = deleteOptions;
        
        delete deleteOptions.maxAge;
        const loginObj = getLogedObject(updatedUser);
        const JWT = jwt.sign(loginObj, JWT_SECRET);
        res
        .clearCookie(`token`, deleteOptions)
        .cookie("token", JWT , newCookieOptions)
        .status(201)
        .json(loginObj);
        return
    } catch (error) {
        console.warn(error);
        return res.status(500).end();
    }
}

async function getMe(req, res) {
    const user = req.user;

    if (!user) {
        if (req.cookies) {
            let options = getOptions(req);
            delete options.maxAge;
            res.clearCookie(`token`, options);
        }
        res.status(200).json({_id : undefined})
        return
    }

    return res.status(200).json(getLogedObject(user));
}

async function changePassowordPatch(req, res) {
    const { password, newPassword } = req.body;
    const user = req.user;
    try {
        const isMatch = await user.comparePassword(password);
        
        if (!isMatch) return res.status(401).json({ message: 'Incorrect password' });

        user.password = newPassword;
        await user.save();

         res.status(201).end();

    } catch (error) {
        console.warn(error)
        res.status(500).end();
    }
}

async function resetPasswordPost(req, res) {
    const email = (req.body.email).trim();
    const fingerprint = req.body.fingerprint;
    
    if(!email) return res.status(500).end();
    
    let user = undefined;
    
    try {
        user = await User.findOne({ email: email }).lean();
        if (!user){
            return res.status(404).end();
        } 
    
        if (user?.verifyTokens?.password) {
            return res.status(400).end();
        }
        res.status(201).json({  message : `Email send at ${email}!`  });

        const payload = {
            fingerprint: fingerprint,
            email: user.email
        }
    
        const token = jwt.sign(payload, JWT_SECRET);

        mail.sendJWTAuth(user.email, token, `password`);
    
        user.verifyTokens.password.fingerprint = fingerprint;
        user.verifyTokens.password.token = tokenHash;
    
        return await user.save();
    
    
    } catch (error) {
        console.warn(error);
        res.status(500).end();
    }
    
}

async function resetPasswordPatch(req, res) {
    const {JWT, fingerprint, newPassword} = req.body;

    const Validate = validateToken(JWT, JWT_SECRET);

    // if (!fingerprintsMatch(Validate.fingerprint, fingerprint)) return res.status(403).end();
    if (!Validate) return res.status(403).end();

    try {
        const user = await User.findOne({ email: Validate.email})
        if (!user) return res.status(403).json();

        user.password = newPassword;
        await user.save();

        return res.status(201).end();
    } catch (error) {
        console.warn(error)
        return res.status(500).end()
    }

}

async function loginPost(req, res) {
    const { email, password, fingerprint } = req.body;

    try {
        const attemptedUser = await User.findOne({email: email});
        if (!attemptedUser) return res.status(409).end();
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
            res
            .cookie("token", JWT, getOptions(req))
            .status(201).json({ _id: newUser._id, email: newUser.email });
            return await mail.sendJWTAuth(email, code, "email");

        } catch (error) {
            const msg = {}

            try {
                const emailExist = await User.findOne({email : email});
                const usernameExist = await User.findOne({username : username});
    
                if (emailExist) msg.email = emailExist.email; 
                if (usernameExist) msg.username = usernameExist.username; 
    
                return res.status(409).json(error);
                
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

async function valdiateTokenPatch(req, res) {
    const { token, option } = req.body;
    const JWT = req.JWT;
    const user = req?.user || undefined;

        if (option == `verify`) {
            const tokenToCheck = user.verifyTokens?.email?.token || undefined
            const JWTToCheck = user?.verifyTokens?.email?.JWT || undefined
            
            if (!tokenToCheck) return res.status(401).end();
            if (true) {
                if (!(await bcrypt.compare(token, tokenToCheck))) {return res.status(401).end()};
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
                    let deleteOptions = getOptions(req)
                    const options = deleteOptions;

                    delete deleteOptions.maxAge;

                    return res
                        .clearCookie("token", deleteOptions)
                        .cookie("token", jwtToken, options)
                        .status(201)
                        .json(loginObject);
                      
                } catch (error) {
                    console.warn(error)
                    return res.status(500).end();
                }
            }
        }
        else if(option == `email`) {
            if (user?.verifyTokens?.newEmail?.token) {
                if (!(bcrypt.compare(token, user.verifyTokens.newEmail.token))) return res.status(401).end();

                try {
                    const updatedUser = await User.findByIdAndUpdate(user._id, {
                        $set: {
                        email: JWT.newEmail
                        },
                        $unset: {
                        'verifyTokens.newEmail': ''
                        }
                    }, { new: true });

                    const loginObject = getLogedObject(updatedUser);

                    const jwtToken = jwt.sign(loginObject, JWT_SECRET);
                    let deleteOptions = getOptions(req);
                    const options = deleteOptions;

                    delete deleteOptions.maxAge;

                    return res
                        .clearCookie("token", deleteOptions)
                        .cookie("token", jwtToken, options)
                        .status(201)
                        .json(loginObject);
                } catch (error) {
                    return res.status(500).end();
                }
            } else return res.status(400).end();
    }
}

async function changeEmailPatch(req, res) {
    const user = req.user;
    if(!user) return res.status(403).end();

    
    const { newEmail } = req.body;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return res.status(400).json({msg : `${newEmail} is not a valid Email!`});

    try {
        const isExisting = await User.findOne({email: newEmail}).lean();
        if (isExisting) return res.status(409).json({msg: `User with ${newEmail} already exists!`});

    } catch (error) {
        res.status(500).end();
        console.warn(error);
    }

    const token = genCode();
    const hashedToken = await cryptCode(token);
    
    try {
        const updatedUser = await User.findByIdAndUpdate(user.id, {
            $set: {
                verifyTokens : {
                    newEmail : {
                        token: hashedToken,
                        newEmail: newEmail,
                    }
                }
            }
        }, {new:true});
        
        const loginObject = getLogedObject(updatedUser);
        loginObject.newEmail = newEmail;
        
        const jwtToken = jwt.sign(loginObject, JWT_SECRET);
        let deleteOptions = getOptions(req)
        const options = deleteOptions;

        delete deleteOptions.maxAge;
        
        res
            .clearCookie("token", deleteOptions)
            .cookie("token", jwtToken, options)
            .status(201)
            .json(loginObject);
        
        return await mail.sendJWTAuth(newEmail, token, `email`);
        
    } catch (error) {
        res.status(500).end();
        return console.warn(error);
    }
}

export default authController;


function genCode() { // Generates a 6 digit code
    return String(Math.floor(100000 + Math.random() * 900000));
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