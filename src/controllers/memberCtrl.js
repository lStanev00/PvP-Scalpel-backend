import { Router } from "express";
import Member from "../Models/Member.js"
import dotenv from 'dotenv';
import validateToken from "../helpers/authToken.js";

dotenv.config({ path: '../../.env' });
const JWT_SECRET = process.env.JWT_SECRET;

const memberCtrl = Router();


memberCtrl.post(`/member`, onPost);
memberCtrl.get(`/member/list`, onGetList)
memberCtrl.post(`/member/list`, onPostList)
memberCtrl.get(`/member/:id`, onGet);

async function onGet(req, res) {
    const id = req.params.id;

    try {
        const search = await Member.findById(id);
        res.status(200).json(search);
        
    } catch (error) {
        res.status(404).json({msg:`Entry's missing.`})
    }
}
async function onPost(req, res) {
    const Authorization = validateToken(req.headers[`in-auth`], JWT_SECRET);

    if(!Authorization) return res.status(401).json({403: `Auth Error`});
    
    let mem = Authorization
    

    
    try {
        const roleMap = {
            0: "Warlord",
            1: "Council",
            2: "Vanguard",
            3: "Envoy",
            4: "Champion",
            5: "Gladiator",
            6: "Slayer",
            7: "Striker",
            8: "Alt / Twink",
            9: `Initiate`,
        };
        mem.rank = roleMap[mem.rank]

        const exist = await Member.findOne({ blizID: mem.blizID });
        if (exist){
            // await Member.findByIdAndUpdate(mem._id, mem);
            await Member.findByIdAndUpdate(exist._id, {
                $set: mem
              });
              
        }else {
            const memTry = new Member(mem);
            await memTry.save();
        }
        res.status(200).json(mem);
    } catch (error) {
        console.log(error);
        res.status(502).json({msg: `error: ${error}`})
        
    }   
}
async function onGetList(req,res) {
    try {
        const memList = await Member.find().lean();
        res.status(200).json(memList);
    } catch (error) {
        res.status(404).json({msg:`There's no such collection`});
    }
}
async function onPostList(req, res) {
    const QUERY = req.body?.query;
    if (!QUERY) return res.status(404).json({msg:`Not FOUND!`});
    const list = {
        "name": 1,
        "playerRealmSlug": 1,
    }
    for (const qr of QUERY) {
        list[`${qr}`] = 1
    }

    try {
        const mgList =  await Member.find({}, list);
        res.status(200).json(mgList);
    } catch (error) {
        return res.status(404).json({msg:`Not FOUND! ${list}`});
    }
}
export default memberCtrl;