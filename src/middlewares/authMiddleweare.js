import dotenv from 'dotenv';
import validateToken from "../helpers/authToken.js";
import User from '../Models/User.js';
import { getOptions } from '../helpers/cookieOptions.js';

const JWT_SECRET = process.env.JWT_SECRET
export async function authMiddleware(req, res, next) {
    const auth1 = req.headers["600"];
    if (!auth1 && auth1 !== "BasicPass") return res.status(500).end();
    if (req.protocol == "https") console.log(`${req.protocol}://${req.get('host')}${req.originalUrl}`);

    
    const JWT = req.cookies.token
    if(!JWT) return next();
    const auth = validateToken(JWT, JWT_SECRET);

    if(!auth){
        res.clearCookie("token", getOptions(req));
        return res.status(403).end();
    }

    try {
        const user = await User.findById(auth._id);

        if(!user){
            res.clearCookie("token", getOptions(req));
            return res.status(403).end();
        }

        if (!fingerprintsMatch(auth.fingerprint, user.fingerprint)) {
            res.clearCookie("token", getOptions(req));
            return res.status(403).end();
        }
        
        req.JWT = auth;
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
  