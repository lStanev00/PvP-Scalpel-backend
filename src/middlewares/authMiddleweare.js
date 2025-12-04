import dotenv from 'dotenv';
import validateToken from "../helpers/authToken.js";
import User from '../Models/User.js';
import { getOptions } from '../helpers/cookieOptions.js';
import { jsonResponse } from '../helpers/resposeHelpers.js';

const JWT_SECRET = process.env.JWT_SECRET
export async function authMiddleware(req, res, next) {
    const auth1 = req.headers["600"];
    if (!auth1 && auth1 !== "BasicPass") return jsonResponse(res, 500);
    const isDesktopOrigin = req.headers.origin === "http://tauri.localhost";
    if(isDesktopOrigin) {
        const desktopAuth = req.headers['desktop'] === 'EiDcafRc45$td4aedrgh4615DESKTOP';
        if(!desktopAuth) return jsonResponse(res, 500);
    }
    
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
            const clearOptions = getOptions(req);
            delete clearOptions.maxAge;
            res.clearCookie("token", clearOptions);
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
  