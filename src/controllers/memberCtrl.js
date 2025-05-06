import { Router } from "express";
import Member from "../Models/Member.js"
import dotenv from 'dotenv';
import validateToken from "../helpers/authToken.js";
import helpFetch from "../helpers/blizFetch-helpers/endpointFetchesBliz.js";
import { jsonMessage, jsonResponse } from "../helpers/resposeHelpers.js";
import Char from "../Models/Chars.js";
import { buildCharacter } from "./characterSearchCTRL.js";

dotenv.config({ path: '../../.env' });
const JWT_SECRET = process.env.JWT_SECRET;

const memberCtrl = Router();


memberCtrl.post(`/member`, onPost);
memberCtrl.get(`/member/list`, onGetList)
memberCtrl.patch(`/member/patch`, patchMemberList)

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

async function onPost(req, res) {
    const Authorization = validateToken(req.headers[`in-auth`], JWT_SECRET);

    if(!Authorization) return res.status(401).json({403: `Auth Error`});
    
    let mem = Authorization
    
    try {

        mem.rank = roleMap[mem.rank]

        const exist = await Member.findOne({ blizID: mem.blizID });
        if (exist){
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
        const rosterList = await Char.find({
            guildMember : true,
        })
        .select(`name playerRealm media server guildInsight`)
        .sort({
            ["guildInsight.rankNumber"]: 1
        })
        .lean();
    
        return jsonResponse(res, 200, rosterList)
        
    } catch (error) {
        console.warn(error);
        return jsonMessage(res, 500, "Internal server error")
    }
}

async function patchMemberList(req, res) {
    
    try {
        const memberList = await helpFetch.getGuildMembers();
        jsonResponse(res, 201, memberList);
        const membersMap = new Map();

        const characterList = await Char.find().lean();
        
        for (const { character, rank }  of memberList) {
            const name = character.name;
            const realmSlug = character.realm.slug;
            membersMap.set(character.id, rank);

            const char = await Char.findOne({
                name: name,
                'playerRealm.slug' : realmSlug
            });

            if (char && char.guildMember == false) {
                await Char.findByIdAndUpdate(char._id, {
                    guildMember : true,
                    "guildInsight.rank": roleMap[rank],
                    "guildInsight.rankNumber": rank,
                });
                await delay(300)
                continue;
            } else if (!char) {
                await buildCharacter("eu", realmSlug, name);
                await delay(2000); // Delay just in case the services are doing update ATM
                continue;
            }

        }

        for (const character of characterList) {
            const isItMember = character.guildMember;

            if (isItMember === true) {
                const existingRank = membersMap.get(character.blizID);

                if (existingRank) {

                    await Char.findByIdAndUpdate(character._id, {
                        guildMember: true,
                        "guildInsight.rank": roleMap[existingRank],
                        "guildInsight.rankNumber": existingRank,
                    });

                    continue;
                }
                
                await Char.findByIdAndUpdate(character._id, {
                    guildMember: false,
                    "guildInsight.rank": undefined,
                    "guildInsight.rankNumber": undefined,
                });
            }
        }

    } catch (error) {
        console.warn(error);

        return jsonMessage(res, 500, "Internal Server ERROR");        
    }

}
export default memberCtrl;


function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }