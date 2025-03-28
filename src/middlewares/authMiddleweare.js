import dotenv from 'dotenv';
import validateToken from "../helpers/authToken.js";
import User from '../Models/User.js';

const JWT_SECRET = process.env.JWT_SECRET
export async function authMiddleware(req, res, next) {
    const auth1 = req.headers["600"];
    if (!auth1 && auth1 !== "BasicPass") return res.status(500).end();
    
    const token = req.cookies.token
    if(!token) return next();
    const auth = validateToken(token, JWT_SECRET);

    if(!auth){
        req.user = undefined;
        return next();
    }

    try {
        const user = await User.findById(auth._id).lean();

        if(!user){
            req.user = undefined;
            return next();
        }

        if (!fingerprintsMatch(auth.fingerprint, user.fingerprint)) {
            return res.status(401).end();
        }
          

        req.user = user;
        next();


    } catch (error) {
        console.warn(error);
        res.status(500).json(error);
    }
    
}


export function fingerprintsMatch(tokenFP, dbFP) {
    if (!tokenFP || !dbFP) return false;
  
    return (
      tokenFP.userAgent === dbFP.userAgent &&
      tokenFP.language === dbFP.language &&
      tokenFP.timezone === dbFP.timezone &&
      tokenFP.device?.memory === dbFP.device?.memory &&
      tokenFP.device?.cpuCores === dbFP.device?.cpuCores
    );
  }
  